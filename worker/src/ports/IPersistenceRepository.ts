/**
 * IPersistenceRepository — Domain Port (Hexagonal-Lite)
 *
 * The cache port that INSULATES Upstash. Core reasoning must never reference the
 * Upstash REST client directly — only this port. The adapter
 * (UpstashCacheAdapter) is the sole place the Upstash `fetch` calls live.
 */
export interface IPersistenceRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Deterministic SHA-256 fingerprint of a system prompt (cache-key component). */
  fingerprint(prompt: string): Promise<string>;
  /** Build the cache key from prompt hash, transcript length, and video id. */
  buildKey(promptHash: string, transcriptLength: number, videoId: string): string;
}
