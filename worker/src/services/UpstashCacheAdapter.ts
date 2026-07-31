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
      return data.result;
    } catch {
      console.warn('[UpstashCacheAdapter] Upstash GET failed, proceeding without cache hit');
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<void> {
    try {
      await rawFetch(`${this.url}/set/${key}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value, ex: ttlSeconds, get: false, xx: false }),
      });
    } catch {
      console.warn('[UpstashCacheAdapter] Upstash SET failed, analysis succeeded but not cached');
    }
  }

  /**
   * Checks the `cancel:{analysisId}` flag web's POST /api/analyses/[id]/cancel
   * writes on explicit user stop. Fails open (false) on any Redis error --
   * same as get() above -- a transient Redis outage must never abort an
   * in-flight, already-paying-for generation as a side effect.
   */
  async isCancelled(analysisId: string): Promise<boolean> {
    try {
      const response = await rawFetch(`${this.url}/get/cancel:${analysisId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { result: string | null };
      return data.result === 'true';
    } catch (error) {
      console.warn('[UpstashCacheAdapter] Upstash GET (isCancelled) failed, proceeding as not-cancelled', error);
      return false;
    }
  }
}
