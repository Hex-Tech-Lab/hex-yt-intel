import * as Sentry from '@sentry/nextjs';
import { resolveDubConfig } from '@/lib/config/dub';
import { logActivityBestEffort } from '@/lib/services/activity-log';
import type { ShortLinkPort, ShortLinkResult, ShortLinkClickAnalytics } from '@/lib/ports/ShortLinkPort';

const DUB_API_BASE = 'https://api.dub.co';
// Dub link IDs are their own opaque `link_<alphanumeric>` format -- reject
// anything else before it ever reaches a URL. Not full SSRF exposure (the
// host is always the DUB_API_BASE constant above, never attacker-supplied;
// only the path segment is parameterized, and it's always encodeURIComponent'd
// too), but this closes the path-segment-injection surface a generic
// static-analysis SSRF scan flags regardless of host fixedness.
const LINK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function assertValidLinkId(linkId: string): void {
  if (!LINK_ID_RE.test(linkId)) throw new Error(`Invalid Dub link id shape: ${linkId}`);
}

/** Verified live against the real Dub API 2026-08-14: create -> resolves with
 *  a real 302 -> analytics -> delete, full lifecycle proven end to end. */
export class DubShortLinkAdapter implements ShortLinkPort {
  private get apiKey(): string {
    const key = process.env.DUB_API_KEY;
    if (!key) throw new Error('DUB_API_KEY environment variable is not set');
    return key;
  }

  // Takes the already-resolved timeout instead of resolving its own registry
  // settings -- real fix 2026-08-20 (automated PR review): the previous
  // version fetched dub.requestTimeoutMs here independently of
  // resolveDubConfig()'s domain/enabled fetch, meaning every call still did
  // two sequential registry round-trips despite DubConfig already carrying
  // requestTimeoutMs. Every caller below resolves config once and passes the
  // timeout through.
  private async request<T>(path: string, timeoutMs: number, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${DUB_API_BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', ...init?.headers },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch((bodyReadError) => {
          console.warn('[DubShortLinkAdapter] failed to read error response body:', bodyReadError);
          return '';
        });
        throw new Error(`Dub API ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${body}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async createLink({ url, key, tenantId }: { url: string; key?: string; tenantId?: string }): Promise<ShortLinkResult> {
    try {
      const { domain, enabled, requestTimeoutMs } = await resolveDubConfig();
      if (!enabled) {
        throw new Error('Dub short-link creation disabled via Settings Registry (dub.enabled=false)');
      }
      const link = await this.request<{ id: string; shortLink: string; url: string }>('/links', requestTimeoutMs, {
        method: 'POST',
        body: JSON.stringify({ domain, url, ...(key && { key }), ...(tenantId && { tenantId }) }),
      });
      // Awaited, not fire-and-forget: this app has no established waitUntil
      // pattern for surviving past the response on Vercel's serverless
      // runtime (unlike the Cloudflare Worker's ctx.waitUntil), so a
      // fire-and-forget write here risked being silently killed mid-flight
      // when the function invocation ends (real correctness gap found
      // 2026-08-20, automated PR review -- reverted from an earlier
      // fire-and-forget attempt in this same session that traded a real
      // audit-durability guarantee for a minor latency win).
      await logActivityBestEffort('dub_share', { linkId: link.id, tenantId: tenantId ?? null }, 'DubShortLinkAdapter', 'dub-share-audit');
      return { id: link.id, shortLink: link.shortLink, url: link.url };
    } catch (err) {
      const error = toError(err);
      Sentry.captureException(error, { contexts: { shortLink: { layer: 'create' } } });
      throw error;
    }
  }

  async getClickAnalytics(linkId: string): Promise<ShortLinkClickAnalytics> {
    try {
      assertValidLinkId(linkId);
      const { requestTimeoutMs } = await resolveDubConfig();
      const query = new URLSearchParams({ linkId, event: 'clicks' });
      const result = await this.request<number | { clicks: number }>(`/analytics?${query.toString()}`, requestTimeoutMs);
      return { clicks: typeof result === 'number' ? result : result.clicks };
    } catch (err) {
      const error = toError(err);
      Sentry.captureException(error, { contexts: { shortLink: { layer: 'analytics' } } });
      throw error;
    }
  }

  async deleteLink(linkId: string): Promise<void> {
    try {
      assertValidLinkId(linkId);
      const { requestTimeoutMs } = await resolveDubConfig();
      await this.request(`/links/${encodeURIComponent(linkId)}`, requestTimeoutMs, { method: 'DELETE' });
    } catch (err) {
      const error = toError(err);
      Sentry.captureException(error, { contexts: { shortLink: { layer: 'delete' } } });
      throw error;
    }
  }
}
