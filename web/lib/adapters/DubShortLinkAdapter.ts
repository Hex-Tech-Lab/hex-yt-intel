import * as Sentry from '@sentry/nextjs';
import type { ShortLinkPort, ShortLinkResult, ShortLinkClickAnalytics } from '@/lib/ports/ShortLinkPort';

const DUB_API_BASE = 'https://api.dub.co';

/** Verified live against the real Dub API 2026-08-14: create -> resolves with
 *  a real 302 -> analytics -> delete, full lifecycle proven end to end. */
export class DubShortLinkAdapter implements ShortLinkPort {
  private get apiKey(): string {
    const key = process.env.DUB_API_KEY;
    if (!key) throw new Error('DUB_API_KEY environment variable is not set');
    return key;
  }

  private get domain(): string {
    return process.env.DUB_DOMAIN || 'link.getmytestdrive.com';
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${DUB_API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Dub API ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async createLink({ url, key, tenantId }: { url: string; key?: string; tenantId?: string }): Promise<ShortLinkResult> {
    try {
      const link = await this.request<{ id: string; shortLink: string; url: string }>('/links', {
        method: 'POST',
        body: JSON.stringify({ domain: this.domain, url, ...(key && { key }), ...(tenantId && { tenantId }) }),
      });
      return { id: link.id, shortLink: link.shortLink, url: link.url };
    } catch (err) {
      Sentry.captureException(err, { contexts: { shortLink: { layer: 'create' } } });
      throw err;
    }
  }

  async getClickAnalytics(linkId: string): Promise<ShortLinkClickAnalytics> {
    try {
      const result = await this.request<number | { clicks: number }>(`/analytics?linkId=${linkId}&event=clicks`);
      return { clicks: typeof result === 'number' ? result : result.clicks };
    } catch (err) {
      Sentry.captureException(err, { contexts: { shortLink: { layer: 'analytics' } } });
      throw err;
    }
  }

  async deleteLink(linkId: string): Promise<void> {
    await this.request(`/links/${linkId}`, { method: 'DELETE' });
  }
}
