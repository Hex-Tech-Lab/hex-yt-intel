/**
 * WorkerPromptConfigAdapter — Persistence Adapter (config-only)
 *
 * RCA (2026-07-24): PromptBuilder previously cross-imported web/lib's
 * getUCISPrompt -> resolveUCISPromptTemplate, which reads Supabase/Redis
 * credentials via `process.env`. Cloudflare Workers has no `process.env` --
 * env arrives through a per-request binding object -- so every read
 * silently failed, each layer's own try/catch swallowed it, and the worker
 * permanently fell through to the hardcoded UCIS_V5_1_SYSTEM default. Live
 * confirmed via Sentry issue HEX-YT-INTEL-3D (SUPABASE_SERVICE_ROLE_KEY not
 * set) -- handled, not crashing, but silently freezing the worker off any
 * live prompt version forever.
 *
 * Per ADR 005 the worker stays DB-access-free: this adapter reads ONLY
 * Upstash Redis (raw REST fetch, mirroring UpstashCacheAdapter's proven
 * pattern -- kept as a separate class since PersistenceRepositoryPort's
 * analysis-cache contract (fingerprint/buildKey) is a different concern
 * from prompt-config lookup, not a shared "sole place" violation). Vercel
 * remains the only writer: web/lib/services/settings.ts's readPromptConfig
 * already warms this exact `config:prompt_config` key on every DB read.
 * If Redis is unreachable or the key is empty, this adapter returns null
 * and PromptBuilder falls back to the embedded UCIS_V5_1_SYSTEM text --
 * same last-known-good behavior as before, just reached without a doomed
 * Supabase round trip on every single request.
 */

import type { PromptConfigPort } from '../ports/PromptConfigPort';

const rawFetch = fetch;

interface PromptConfig {
  latest?: string;
  history?: unknown;
  versions?: Record<string, string>;
  [key: string]: unknown;
}

function getHighestVersion(versions: string[]): string | undefined {
  if (versions.length === 0) return undefined;
  return [...versions].sort((a, b) => {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] ?? 0;
      const bVal = bParts[i] ?? 0;
      if (aVal !== bVal) return bVal - aVal;
    }
    return 0;
  })[0];
}

export class WorkerPromptConfigAdapter implements PromptConfigPort {
  private url: string;
  private token: string;

  constructor({ url, token }: { url: string; token: string }) {
    this.url = url;
    this.token = token;
  }

  private async readConfig(): Promise<PromptConfig | null> {
    try {
      const response = await rawFetch(`${this.url}/get/config:prompt_config`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { result: string | null };
      if (!data.result) return null;
      return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
    } catch {
      console.warn('[WorkerPromptConfigAdapter] Redis GET failed, caller falls back to embedded prompt');
      return null;
    }
  }

  /** Returns the live DB-backed template text, or null to signal "use the embedded fallback." */
  async resolvePromptTemplate(version?: string): Promise<string | null> {
    const cfg = await this.readConfig();
    if (!cfg) return null;

    let targetVersion = version;
    if (!targetVersion) {
      const keys = Object.keys(cfg.versions || {});
      if (keys.length > 0) {
        targetVersion = cfg.latest || getHighestVersion(keys);
      } else {
        const legacyKeys = Object.keys(cfg).filter((k) => k !== 'latest' && k !== 'history' && k !== 'versions');
        targetVersion = cfg.latest || getHighestVersion(legacyKeys);
      }
    }

    if (targetVersion) {
      const dbPrompt = cfg.versions?.[targetVersion] || cfg[targetVersion];
      if (typeof dbPrompt === 'string' && dbPrompt.trim().length > 0) {
        return dbPrompt;
      }
    }

    return null;
  }
}
