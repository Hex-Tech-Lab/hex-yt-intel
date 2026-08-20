import * as Sentry from '@sentry/nextjs';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { resolveDubConfig } from '@/lib/config/dub';
import { logActivityBestEffort } from '@/lib/services/activity-log';
import type { ShortLinkPort, ShortLinkResult, ShortLinkClickAnalytics } from '@/lib/ports/ShortLinkPort';

const DUB_API_BASE = 'https://api.dub.co';
const REGISTRY_FALLBACK = { 'dub.requestTimeoutMs': 8000 } as const;
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

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const settings = await SupabaseSettingsAdapter.getRegistrySettings(Object.keys(REGISTRY_FALLBACK), REGISTRY_FALLBACK);
    const timeoutMs = Number(settings['dub.requestTimeoutMs']) || REGISTRY_FALLBACK['dub.requestTimeoutMs'];

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
      const { domain, enabled } = await resolveDubConfig();
      if (!enabled) {
        throw new Error('Dub short-link creation disabled via Settings Registry (dub.enabled=false)');
      }
      const link = await this.request<{ id: string; shortLink: string; url: string }>('/links', {
        method: 'POST',
        body: JSON.stringify({ domain, url, ...(key && { key }), ...(tenantId && { tenantId }) }),
      });
      // Fire-and-forget: a real user-facing Share click shouldn't wait on an
      // audit-log DB round-trip (real efficiency finding 2026-08-20, /simplify
      // review) -- logActivityBestEffort already swallows its own errors.
      void logActivityBestEffort('dub_share', { linkId: link.id, tenantId: tenantId ?? null }, 'DubShortLinkAdapter');
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
      const query = new URLSearchParams({ linkId, event: 'clicks' });
      const result = await this.request<number | { clicks: number }>(`/analytics?${query.toString()}`);
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
      await this.request(`/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
    } catch (err) {
      const error = toError(err);
      Sentry.captureException(error, { contexts: { shortLink: { layer: 'delete' } } });
      throw error;
    }
  }
}
