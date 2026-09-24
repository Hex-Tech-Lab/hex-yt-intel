/**
 * TranscriptExtractor — chain orchestrator over TranscriptProviderPort providers
 * qa-intel: no stream state here to call settleAnalysis or setError
 *
 * Configurable fallback chain (2026-09-24, Decodo 429 incident): the provider
 * order comes from TRANSCRIPT_PROVIDER_ORDER (comma list, default
 * "apify,decodo,native"). Each provider is tried in order; the placeholder
 * tier is always the final fallback and is not part of the order.
 *
 * NOTE: this worker cannot read the Supabase Settings Registry directly (per
 * ADR 005 it stays DB-access-free; registry-resolved values reach it only via
 * request-payload forwarding), so the order is env-var-only here.
 */

import { addBreadcrumb, captureException, captureMessage } from '@sentry/cloudflare';
import { fetchWithProxy } from './http-utils';
import { ApifyTranscriptProvider } from './providers/ApifyTranscriptProvider';
import { DecodoTranscriptProvider } from './providers/DecodoTranscriptProvider';
import { YouTubeNativeTranscriptProvider } from './providers/YouTubeNativeTranscriptProvider';
import { NoCaptionsConfirmedError } from '../ports/TranscriptProviderPort';
import type { TranscriptProviderPort, TranscriptResult } from '../ports/TranscriptProviderPort';

const DEFAULT_PROVIDER_ORDER = 'apify,decodo,native';

/**
 * Parses TRANSCRIPT_CHAIN_BUDGET_MS from env into a finite budget in ms.
 * Guarded coercion: a missing, non-numeric or non-positive value yields
 * undefined so the caller falls back to DEFAULT_CHAIN_BUDGET_MS.
 */
export function parseChainBudgetMs(raw?: string): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Chain budget derivation (2026-09-25, PR #336 round 2): the Apify tier can
// block for up to 130000ms (its own abort, > the actor's 120s timeout). The
// budget must therefore leave at least 30s for the remaining fallback tiers
// (decodo 30s + native ~25s of internal deadlines) before the placeholder:
// 130000 (Apify worst case) + 30000 (fallback floor) = 160000ms. Overridable
// via TRANSCRIPT_CHAIN_BUDGET_MS (worker is DB-free per ADR 005, so env only).
const DEFAULT_CHAIN_BUDGET_MS = 160000;

const VALID_PROVIDER_NAMES = ['apify', 'decodo', 'native'] as const;
type ProviderName = typeof VALID_PROVIDER_NAMES[number];

export class TranscriptExtractor implements TranscriptProviderPort {
  private residentialProxyUrl?: string;
  private decodoApiKey?: string;
  private apifyToken?: string;
  private providerOrder: ProviderName[];
  private chainBudgetMs: number;

  constructor(
    residentialProxyUrl?: string,
    decodoApiKey?: string,
    providerOrder?: string,
    apifyToken?: string,
    chainBudgetMs?: number,
  ) {
    this.residentialProxyUrl = residentialProxyUrl;
    this.decodoApiKey = decodoApiKey;
    this.apifyToken = apifyToken;
    this.chainBudgetMs = chainBudgetMs ?? DEFAULT_CHAIN_BUDGET_MS;
    this.providerOrder = TranscriptExtractor.parseProviderOrder(providerOrder);
  }

  static parseProviderOrder(order?: string): ProviderName[] {
    const raw = order?.trim() || DEFAULT_PROVIDER_ORDER;
    const parsed = raw.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
    const valid: ProviderName[] = [];
    const invalid: string[] = [];
    for (const entry of parsed) {
      if ((VALID_PROVIDER_NAMES as readonly string[]).includes(entry)) {
        if (!valid.includes(entry as ProviderName)) valid.push(entry as ProviderName);
      } else {
        invalid.push(entry);
      }
    }
    if (invalid.length > 0) {
      const msg = `[transcript] TRANSCRIPT_PROVIDER_ORDER contains unknown provider name(s): ${invalid.join(', ')} (valid: ${VALID_PROVIDER_NAMES.join(', ')})`;
      console.warn(msg);
      // The invalid entry is silently dropped from the chain -- make that
      // visible in Sentry so a typo in the env var does not silently shrink
      // the fallback chain in production.
      addBreadcrumb({
        level: 'warning',
        message: 'Unknown transcript provider in TRANSCRIPT_PROVIDER_ORDER',
        category: 'config',
        data: { invalid: invalid.join(','), raw },
      });
    }
    return valid.length > 0 ? valid : [...new Set(DEFAULT_PROVIDER_ORDER.split(',') as ProviderName[])];
  }

  protected buildProviders(): Array<{ name: ProviderName; provider: TranscriptProviderPort }> {
    const providers: Array<{ name: ProviderName; provider: TranscriptProviderPort }> = [];
    for (const name of this.providerOrder) {
      if (name === 'apify') providers.push({ name, provider: new ApifyTranscriptProvider(this.apifyToken) });
      else if (name === 'decodo') providers.push({ name, provider: new DecodoTranscriptProvider(this.residentialProxyUrl, this.decodoApiKey) });
      else providers.push({ name, provider: new YouTubeNativeTranscriptProvider(this.residentialProxyUrl, this.decodoApiKey) });
    }
    return providers;
  }

  async fetch(videoId: string): Promise<TranscriptResult> {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      throw new Error(`Invalid video ID format: ${videoId}`);
    }

    // Accumulates one entry per provider tried this run, so a single Sentry
    // event at the end can show the FULL picture ("Apify: timeout, Decodo:
    // 429, standard API: no tracks") instead of separate, hard-to-correlate
    // exception events that each only know their own tier.
    const tierFailures: Array<{ tier: string; reason: string }> = [];
    let confirmedNoCaptions = false;

    // Total chain budget (2026-09-25): the Apify tier alone can block up to
    // 130s, which previously left nothing for the fallback tiers. Every
    // provider attempt is now bounded by the remaining budget; when it is
    // exhausted the remaining providers are skipped (recorded as failures)
    // and the placeholder still answers. Tunable via TRANSCRIPT_CHAIN_BUDGET_MS.
    const budgetDeadline = Date.now() + this.chainBudgetMs;

    for (const { name, provider } of this.buildProviders()) {
      const remainingMs = budgetDeadline - Date.now();
      if (remainingMs <= 0) {
        const msg = `chain budget (${this.chainBudgetMs}ms) exhausted before ${name}`;
        console.warn(`[transcript] ${msg} for ${videoId}`);
        tierFailures.push({ tier: name, reason: msg });
        continue;
      }
      // try/finally guarantees every provider attempt (success or failure)
      // reports its latency as a breadcrumb -- per-tier latency is exactly
      // what you need when RCA'ing which tier is slow/dead (e.g. the Decodo
      // 429 incident this chain refactor came from).
      let attemptStarted = 0;
      let budgetTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        console.info(`[transcript] Trying ${name} for ${videoId}...`);
        attemptStarted = Date.now();
        const attempt = provider.fetch(videoId);
        const budgetAbort = new Promise<never>((_, reject) => {
          budgetTimer = setTimeout(() => reject(new Error(`${name} exceeded remaining chain budget (${remainingMs}ms)`)), remainingMs);
        });
        return await Promise.race([attempt, budgetAbort]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[transcript] ${name} failed for ${videoId}: ${msg}`);
        if (name === 'native') {
          confirmedNoCaptions = e instanceof NoCaptionsConfirmedError;
          // The native provider reports its own sub-tier failures to Sentry
          // with fine-grained tags (transcript-standard-api / transcript-page-html).
        } else {
          captureException(e, { tags: { operation: `transcript-${name}`, videoId } });
        }
        tierFailures.push({ tier: name, reason: msg });
      } finally {
        if (budgetTimer) clearTimeout(budgetTimer);
        if (attemptStarted > 0) {
          console.debug(`[transcript] ${name} attempt for ${videoId} settled after ${Date.now() - attemptStarted}ms`);
        }
      }
    }

    console.info(`[transcript] Trying Tertiary for ${videoId}...`);
    if (!confirmedNoCaptions) {
      // Every provider failed and none confirmed the video simply has no
      // captions -- this is the case that needs full RCA visibility, since
      // it means our pipeline (not the video) is the problem.
      captureMessage(`Transcript pipeline exhausted for ${videoId}`, {
        level: 'error',
        tags: { operation: 'transcript-pipeline-exhausted', videoId },
        extra: { tierFailures },
      });
    }
    return this.fetchWithTertiary(videoId, confirmedNoCaptions);
  }

  private fetchWithTertiary(videoId: string, confirmedNoCaptions: boolean): TranscriptResult {
    return {
      videoId,
      transcript: confirmedNoCaptions
        ? '[No captions available for this video]'
        : '[Transcript unavailable for this video - content ingestion failed across all available sources]',
      language: 'en',
      confirmedNoCaptions,
    };
  }

  async fetchChannelMetadata(channelId: string): Promise<Record<string, unknown> | null> {
    if (!this.decodoApiKey) return null;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    try {
      const response = await fetchWithProxy('https://scraper-api.decodo.com/v2/scrape', {
        method: 'POST',
        signal,
        headers: {
          'Authorization': `Basic ${this.decodoApiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          target: 'youtube_channel',
          query: channelId,
          parse: true,
          limit: 1,
        }),
      }, this.residentialProxyUrl);
      if (!response.ok) {
        // RCA (2026-07-24): this branch returned null with zero logging --
        // same silent-swallow shape fixed in MetadataScraper.fetchComments
        // tonight (see that RCA). A non-2xx from Decodo (rate limit,
        // account issue, target-site block) was indistinguishable from
        // "this channel genuinely has no metadata."
        const bodyText = await response.text().catch(() => '');
        console.warn(`[transcript] Channel metadata fetch non-ok for ${channelId}: ${response.status} ${response.statusText}`, bodyText.slice(0, 300));
        captureMessage(`Channel metadata fetch non-ok: ${channelId}`, {
          level: 'warning',
          tags: { operation: 'transcript-channel-metadata', status: String(response.status) },
          extra: { channelId, status: response.status, body: bodyText.slice(0, 300) },
        });
        return null;
      }
      const data = await response.json() as { results?: Array<{ content?: unknown }> };
      return data.results?.[0]?.content as Record<string, unknown> ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[transcript] Channel metadata fetch failed for ${channelId}: ${msg}`);
      captureException(e, { tags: { operation: 'transcript-channel-metadata', channelId } });
      return null;
    } finally { controller.abort(); }
  }
}