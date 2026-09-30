/**
 * UpstashCacheAdapter - Persistence Adapter (config-only)
 *
 * Implements PersistenceRepositoryPort. The SOLE place Upstash REST `fetch` calls
 * live — core reasoning never touches the Upstash client directly, only this port.
 * Config-only (url + token): no request-scoped mutable state, safe to share.
 */

import type { PersistenceRepositoryPort } from '../ports/PersistenceRepositoryPort';

const rawFetch = fetch;

const DEFAULT_TTL_SECONDS = 604800; // 7 days

/**
 * Entries written before the 2026-09-30 SET fix hold the literal request
 * envelope {"value":"<real json>","ex":N,"get":false,"xx":false} instead of
 * the value (see set() below). The real value is intact inside it, so a GET
 * unwraps it: every poisoned key (comments-sampled:*, channel-meta:*) is
 * readable again without a production purge, and they age out on their TTL.
 */
export function unwrapLegacySetEnvelope(raw: string | null): string | null {
  if (raw === null || !raw.startsWith('{"value":')) return raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.value === 'string' && 'ex' in parsed) return parsed.value;
  } catch {
    console.debug('[UpstashCacheAdapter] value starts like a legacy SET envelope but is not JSON; returning it unchanged');
  }
  return raw;
}

export class UpstashCacheAdapter implements PersistenceRepositoryPort {
  private url: string;
  private token: string;

  constructor({ url, token }: { url: string; token: string }) {
    this.url = url;
    this.token = token;
  }

  /** Deterministic SHA-256 fingerprint of a system prompt. */
  async fingerprint(prompt: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(prompt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Build the deterministic cache key. */
  buildKey(promptHash: string, transcriptLength: number, videoId: string): string {
    return `analysis::${promptHash}::${transcriptLength}::${videoId}`;
  }

  async get(key: string): Promise<string | null> {
    try {
      const response = await rawFetch(`${this.url}/get/${key}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { result: string | null };
      return unwrapLegacySetEnvelope(data.result);
    } catch {
      console.warn('[UpstashCacheAdapter] Upstash GET failed, proceeding without cache hit');
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<void> {
    try {
      // RCA (2026-09-30): Upstash REST's POST /set/{key} treats the ENTIRE
      // raw request body as the value — options like `ex`/`xx` belong in
      // query params. The previous JSON body {value, ex, get, xx} made
      // Upstash store the whole envelope as the value, so every worker
      // cache entry was unreadable garbage on the next cache hit: comments
      // normalized to null (silent comment loss, post-2026-09-27) and
      // channelMeta persisted as the literal envelope. Options moved to
      // the URL, matching the documented REST contract.
      const params = new URLSearchParams({ ex: String(ttlSeconds) });
      await rawFetch(`${this.url}/set/${key}?${params.toString()}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
        body: value,
      });
    } catch {
      console.warn('[UpstashCacheAdapter] Upstash SET failed, analysis succeeded but not cached');
    }
  }

  /**
   * Checks the `cancel:{analysisId}` flag web's POST /api/analyses/[id]/cancel
   * writes on explicit user stop. Delegates to get() (same fetch/auth wiring,
   * same fail-open-to-null-on-error behavior) rather than duplicating the
   * Upstash REST call shape -- a transient Redis outage must never abort an
   * in-flight, already-paying-for generation as a side effect.
   */
  async isCancelled(analysisId: string): Promise<boolean> {
    return (await this.get(`cancel:${analysisId}`)) === 'true';
  }
}
