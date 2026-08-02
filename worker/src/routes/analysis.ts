import { Hono } from "hono";
import * as Sentry from "@sentry/cloudflare";
import { TranscriptExtractor } from "../services/TranscriptExtractor";
import { MetadataScraper, type VideoComment } from "../services/MetadataScraper";
import type { TranscriptSegment } from "../ports/TranscriptProviderPort";
import { ReasoningEngine } from "../services/ReasoningEngine";
import { PromptBuilder } from "../services/PromptBuilder";
import { LLMCascade } from "../services/LLMCascade";
import { ValidationService } from "../services/ValidationService";
import { UpstashCacheAdapter } from "../services/UpstashCacheAdapter";
import { WorkerPromptConfigAdapter } from "../adapters/WorkerPromptConfigAdapter";
import { PersistService } from "../services/PersistService";
import { createAtomicPersist } from "../services/atomic-persist";
import { hmacHex, secretFingerprint } from "../crypto";
import { isProductionEnv } from "../env-utils";
import { stratifiedSampleIndices, type StratifiableComment } from "../../../web/lib/services/comment-sampling";
import { isValidAppUrl } from "../middleware/cors";
import type { ReasoningEnginePort, StreamStatusEvent } from "../ports/ReasoningEnginePort";

declare const process: any;



/** Compare two hex strings for equality using constant-time comparison to prevent timing attacks. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type AnalysisEnv = {
  YOUTUBE_API_KEY: string;
  OPENROUTER_API_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  STREAM_HMAC_SECRET: string;
  APP_URL?: string;
  SENTRY_DSN?: string;
  ALLOWED_APP_ORIGINS?: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  DEV_HMAC_SECRET?: string;
  RESIDENTIAL_PROXY_URL?: string;
  DECODO_API_KEY?: string;
};

if (typeof process !== 'undefined' && process.env?.RESIDENTIAL_PROXY_URL === undefined) {
  console.debug('[analyze-llm-stream] RESIDENTIAL_PROXY_URL not configured, YouTube fallback unavailable', { config: 'proxy-disabled' });
}

interface AnalysisRequest {
  videoId: string;
  transcript: string;
  metadata: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    duration: number;
    viewCount: string;
    likeCount: string;
    commentCount: string;
  };
  persona: string;
  timezone: string;
  systemPrompt?: string;
}

interface StreamRequest {
  videoId: string;
  analysisId: string;
  // Forwarded to OpenRouter's `user` field for abuse-correlation (2026-07-30).
  // Optional and never trusted for authorization -- Vercel already
  // authenticated/quota-gated the caller before this request was signed.
  userId?: string;
  transcript: string;
  segments?: Array<{ start: number; duration: number; text: string }>;
  metadata: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    duration: number;
    viewCount: string | number;
    likeCount: string | number;
    commentCount: string | number;
  };
  persona: string;
  timezone: string;
  models?: string[];
  // Full registry-resolved cascade (2026-07-25, forwarded from CreateAnalysisUseCase
  // via resolveAnalysisCascade -- see web/lib/config/cascade.ts) including providerOrder
  // per tier, which `models` (flat id list, signed into the HMAC token) can't carry when
  // multiple tiers share the same model id across different providers. Preferred over
  // `models` when present; `models` stays as the signed/legacy fallback for stale clients.
  cascade?: Array<{ model: string; name: string; cost?: number; providerOrder?: string[] }>;
  // Registry-resolved (2026-07-25, analysis.maxOutputTokens.*) -- see LLMCascade.ts's
  // MAX_TOKENS_FALLBACK for why this must never be hardcoded worker-side again.
  maxOutputTokens?: { haiku: number; default: number };
  sig: string;
  exp: number;
  appUrl?: string;
  dimensions?: number[];
  chunkIndex?: number;
  totalChunks?: number;
  // Resolved server-side (Vercel has the DB access this worker doesn't, see
  // ADR 005) from the settings registry's chat.comments.* keys and forwarded
  // per-request -- never hardcode these worker-side, see fetchCommentsCached.
  commentsConfig?: {
    maxResults: number;
    maxAttempts: number;
    timeoutPerAttemptMs: number;
    maxPayloadBytes: number;
  };
  // Same reasoning as commentsConfig -- see fetchChannelMetaCached.
  channelMetaConfig?: {
    timeoutMs: number;
    maxPayloadBytes: number;
  };
  // Resolved server-side by CreateAnalysisUseCase from CommentSamplingPort
  // (registry-backed) -- see fetchSampledCommentsCached. Undefined means a
  // stale/old client; the worker falls back to the flat single-page fetch.
  commentsSamplePlan?: {
    targetSampleCount: number;
    likeBucketCount: number;
    recencyBucketCount: number;
  };
  // Same reasoning as commentsConfig -- bounds fetchSampledCommentsCached's
  // pool-build loop (pages + time budget), not the sample size itself.
  commentsSyncPoolConfig?: {
    maxPages: number;
    timeoutMs: number;
  };
}

interface TokenVerificationResult {
  isValid: boolean;
  secret: string;
  msg: string;
}

/** Verify HMAC signature of stream request token using stored secret. Returns validation result and secret. */
async function verifyStreamToken(
  videoId: string,
  analysisId: string,
  exp: number,
  sig: string,
  models: string[] | undefined,
  env: AnalysisEnv,
): Promise<TokenVerificationResult> {
  const secret = env.STREAM_HMAC_SECRET;

  if (Date.now() > exp) {
    return { isValid: false, secret: "", msg: "" };
  }

  const activeSecret = secret;
  const secretsToTry = [secret];

  // DEV_HMAC_SECRET is a local/preview convenience only — never accept it in
  // production (matches the chat verifier; prevents a non-prod secret from
  // authenticating against the prod worker).
  if (!isProductionEnv(env) && env.DEV_HMAC_SECRET) {
    secretsToTry.push(env.DEV_HMAC_SECRET);
  }

  for (const s of secretsToTry) {
    if (!s) continue;
    const modelStr = [...(models ?? [])].sort().join(",");
    const msg = `${videoId}:${analysisId}:${exp}:${modelStr}`;
    const expected = await hmacHex(s, msg);

    if (timingSafeEqualHex(expected, sig)) {
      return { isValid: true, secret: s, msg: "" };
    }
  }

  const modelStr = [...(models ?? [])].sort().join(",");
  const msg = `${videoId}:${analysisId}:${exp}:${modelStr}`;
  return { isValid: false, secret: activeSecret, msg };
}

interface ResolvedTranscript {
  transcript: string | undefined;
  segments?: TranscriptSegment[];
  channelMeta?: Record<string, unknown> | null;
  comments?: VideoComment[] | null;
  // See TranscriptResult.confirmedNoCaptions -- undefined/false means "we
  // don't know why the transcript is missing," not "confirmed absent."
  confirmedNoCaptions?: boolean;
}

/**
 * Fetch video transcript if missing or invalid; attempts cache then multiple sources.
 *
 * RCA (2026-07-22): this used to return `string | undefined` (flat text only), while
 * `TranscriptExtractor.fetch()` already produces timed `segments` internally
 * (`fetchFromPageHTML`/`fetchWithDecodo`). Those segments were discarded here, so the
 * persist call downstream fell back to `req.segments` — the ORIGINAL request's segments
 * field, which the browser never populates (Vercel deliberately blanks the transcript
 * before minting the stream token; the real transcript is only ever fetched here,
 * worker-side). Net effect: the `transcripts` table almost never got a row, so chat
 * grounding correctly-but-confusingly reported "no transcript" on analyses that DID
 * have one. Returning segments alongside the flat text closes that gap for the fresh-
 * fetch path; the cache round-trip below now also carries segments so repeat analyses
 * of the same video (cache HIT) don't regress back to segment-less.
 */
// Bounds how much latency the (best-effort) channel-metadata enrichment can add
// to the critical path. RCA (2026-07-23): the first version of this awaited the
// full 15s fetchChannelMetadata timeout unconditionally on EVERY one of the 5
// parallel bundle streams per analysis, including the fast path where a
// transcript was already known and no network call was otherwise needed --
// turning an instant return into a call that could stall up to 15s per bundle
// for a "nice to have" field, risking the exact stream-timeout/billing-failure
// class of bug A6/A7 fixed. Bounded so a slow/degraded Decodo never delays
// synthesis; on timeout we simply proceed without channel metadata.
// Resolved server-side (Vercel has the DB access this worker doesn't, see
// ADR 005) from the settings registry's chat.channelMeta.* keys and forwarded
// per-request -- must be kept in sync with the registry's seeded defaults
// (20260724120000_channel_meta_fetch_settings.sql), used only when a request
// doesn't carry channelMetaConfig (stale/old client) or the registry itself
// is unreachable.
const CHANNEL_META_CONFIG_FALLBACK = { timeoutMs: 4000, maxPayloadBytes: 20_000 };
// 7-day TTL: channel-level stats (subscriber count, description) change far
// slower than per-video data, and this also protects against hitting Decodo
// 5x per analysis (once per parallel bundle stream) -- see call site.
const CHANNEL_META_CACHE_TTL = 604_800;

function truncateChannelMeta(
  meta: Record<string, unknown> | null,
  channelId: string | undefined,
  config: typeof CHANNEL_META_CONFIG_FALLBACK,
): Record<string, unknown> | null {
  if (!meta) return null;
  const serialized = JSON.stringify(meta);
  if (serialized.length <= config.maxPayloadBytes) return meta;
  // RCA (2026-07-24): this drop path had zero Sentry telemetry, unlike the fetch's
  // non-ok/exception branches -- "has_channel_meta" chip consistently grey with no
  // corresponding issue anywhere was the symptom that led here.
  console.warn(`[analyze-llm-stream] channelMeta exceeds ${config.maxPayloadBytes}B (${serialized.length}B), dropping`);
  Sentry.captureMessage(`channel-meta dropped: exceeds size cap`, {
    level: 'warning',
    tags: { operation: 'channel-meta-truncate', channelId: channelId ?? 'unknown' },
    extra: { channelId, byteSize: serialized.length, capBytes: config.maxPayloadBytes },
  });
  return null;
}

async function fetchChannelMetaCached(
  channelId: string | undefined,
  env: Pick<AnalysisEnv, "RESIDENTIAL_PROXY_URL" | "DECODO_API_KEY" | "YOUTUBE_API_KEY">,
  cache?: UpstashCacheAdapter,
  config: typeof CHANNEL_META_CONFIG_FALLBACK = CHANNEL_META_CONFIG_FALLBACK,
): Promise<Record<string, unknown> | null> {
  if (!channelId) return null;
  const cacheKey = `channel-meta:${channelId}`;

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached) as Record<string, unknown>;
        } catch {
          console.debug(`[analyze-llm-stream] channel-meta cache entry for ${channelId} is not JSON, ignoring`);
        }
      }
    } catch {
      console.warn(`[analyze-llm-stream] channel-meta cache GET failed for ${channelId}, proceeding with fetch`);
    }
  }

  // RCA (2026-07-24): this previously swallowed the error completely
  // (.catch(() => null), no logging anywhere -- not console, not Sentry),
  // so a genuinely broken/flaky metadata fetch was silently indistinguishable
  // from "this channel just has no metadata." A live investigation into
  // repeatedly-null commentCount/comments on one specific video hit a dead
  // end here: no error was ever recorded to trace. captureMessage makes the
  // next occurrence diagnosable by channelId + actual error text.
  const fetchPromise = new TranscriptExtractor(env.RESIDENTIAL_PROXY_URL, env.DECODO_API_KEY)
    .fetchChannelMetadata(channelId)
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[analyze-llm-stream] channel-meta fetch failed for ${channelId}:`, message);
      Sentry.captureMessage(`channel-meta fetch failed: ${channelId}`, {
        level: 'warning',
        tags: { operation: 'channel-meta-fetch' },
        extra: { channelId, error: message },
      });
      return null;
    });
  // RCA (2026-07-29): the UCIS prompt's Dimension 2.3/11.1/11.6 explicitly ask
  // for subscriber count, channel age, and video count -- always Insufficient
  // Data because Decodo's scrape above returns an opaque, untyped blob whose
  // shape was never verified to contain these fields, and nothing else fetched
  // them at all. Run alongside (not instead of) the Decodo fetch -- the typed,
  // authoritative YouTube Data API call, merged in below under stable key
  // names the prompt can rely on regardless of what Decodo's blob contains.
  const statsFetchPromise = env.YOUTUBE_API_KEY
    ? new MetadataScraper(env.YOUTUBE_API_KEY, env.RESIDENTIAL_PROXY_URL)
        .fetchChannelDetails(channelId)
        .catch((err) => {
          console.warn(`[analyze-llm-stream] channel stats fetch failed for ${channelId}:`, err instanceof Error ? err.message : String(err));
          return null;
        })
    : Promise.resolve(null);
  let timedOut = false;
  const timeoutPromise = new Promise<[null, null]>((resolve) =>
    setTimeout(() => {
      timedOut = true;
      resolve([null, null]);
    }, config.timeoutMs)
  );
  const [raced, stats] = await Promise.race([Promise.all([fetchPromise, statsFetchPromise]), timeoutPromise]);
  if (timedOut) {
    // RCA (2026-07-24): the other two failure paths in this function report to
    // Sentry; the race-timeout path silently returned null with no telemetry at
    // all, making a "always grey, never any errors" symptom appear directly
    // caused by this gap.
    console.warn(`[analyze-llm-stream] channel-meta fetch exceeded ${config.timeoutMs}ms budget for ${channelId}, proceeding without it`);
    Sentry.captureMessage(`channel-meta dropped: fetch exceeded time budget`, {
      level: 'warning',
      tags: { operation: 'channel-meta-timeout', channelId: channelId ?? 'unknown' },
      extra: { channelId, budgetMs: config.timeoutMs },
    });
  }
  // Merge under stable, verified key names -- separate from whatever Decodo's
  // opaque scrape blob (raced) does or doesn't contain, so the prompt can
  // reference these three fields with confidence regardless of Decodo's shape.
  const merged: Record<string, unknown> | null = raced || stats
    ? {
        ...(raced || {}),
        ...(stats?.subscriberCount !== undefined ? { subscriberCount: stats.subscriberCount } : {}),
        ...(stats?.videoCount !== undefined ? { channelVideoCount: stats.videoCount } : {}),
        ...(stats?.channelPublishedAt ? { channelPublishedAt: stats.channelPublishedAt } : {}),
      }
    : null;
  const result = truncateChannelMeta(merged, channelId, config);

  if (result && cache) {
    cache.set(cacheKey, JSON.stringify(result), CHANNEL_META_CACHE_TTL).catch(() => {
      console.warn(`[analyze-llm-stream] channel-meta cache SET failed for ${channelId}`);
    });
  }
  return result;
}

// Same rationale as channel-meta caching above: comments come from a separate
// YouTube Data API call (commentThreads.list) with its own quota, so bound and
// cache it rather than block/repeat per bundle stream. 7-day TTL — top
// relevance-ordered comments on an existing video churn slowly.
//
// Fetch sizing/timeout are NOT hardcoded here (see 2026-07-23 RCA: a flat 4s
// timeout raced a function that internally retried twice through a
// residential proxy and lost nearly every time, going straight to a 9s
// version of the same mistake). They come from `CommentsFetchConfig`,
// resolved server-side from the settings registry (chat.comments.*) by
// CreateAnalysisUseCase and forwarded per-request -- this worker has no DB
// access to read the registry itself (ADR 005: it's a pure fetch/stream
// service). CONFIG_FALLBACK below is only a last-resort default for requests
// from a stale/old client that never sent commentsConfig; it must be kept in
// sync with the registry's seeded defaults (20260723190000_comments_fetch_settings.sql).
const COMMENTS_CONFIG_FALLBACK = { maxResults: 20, maxAttempts: 2, timeoutPerAttemptMs: 4000, maxPayloadBytes: 20_000 };
const COMMENTS_CACHE_TTL = 604_800;

function truncateComments(comments: VideoComment[] | null, maxBytes: number): VideoComment[] | null {
  if (!comments || comments.length === 0) return null;
  const serialized = JSON.stringify(comments);
  if (serialized.length <= maxBytes) return comments;
  console.warn(`[analyze-llm-stream] comments exceed ${maxBytes}B (${serialized.length}B), truncating list`);
  // Drop from the end (already relevance-ordered) until it fits.
  const trimmed = [...comments];
  while (trimmed.length > 0 && JSON.stringify(trimmed).length > maxBytes) {
    trimmed.pop();
  }
  return trimmed.length > 0 ? trimmed : null;
}

async function fetchCommentsCached(
  videoId: string,
  env: Pick<AnalysisEnv, "YOUTUBE_API_KEY" | "RESIDENTIAL_PROXY_URL">,
  cache?: UpstashCacheAdapter,
  // The video's total comment count, already fetched during ingestion's
  // videos.list call (req.metadata.commentCount) -- checking it here first
  // means a video with comments disabled or zero comments never spends a
  // second API call (commentThreads.list) finding that out the hard way.
  // Undefined (field missing/never fetched) still falls through to the real
  // fetch rather than being treated as "known zero". It ALSO sizes the
  // request itself below: never ask for more comments than are known to
  // exist (check -> count -> estimate, not a blind fixed page size).
  knownCommentCount?: number,
  config: typeof COMMENTS_CONFIG_FALLBACK = COMMENTS_CONFIG_FALLBACK,
): Promise<VideoComment[] | null> {
  if (!env.YOUTUBE_API_KEY) return null;
  if (knownCommentCount === 0) return null;
  const cacheKey = `comments:${videoId}`;

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached) as VideoComment[];
        } catch {
          console.debug(`[analyze-llm-stream] comments cache entry for ${videoId} is not JSON, ignoring`);
        }
      }
    } catch {
      console.warn(`[analyze-llm-stream] comments cache GET failed for ${videoId}, proceeding with fetch`);
    }
  }

  // Sized against the KNOWN count, not the configured cap blindly -- a video
  // with 5 comments has no reason to request page-size 20.
  const effectiveMaxResults =
    typeof knownCommentCount === 'number' && knownCommentCount > 0
      ? Math.min(config.maxResults, knownCommentCount)
      : config.maxResults;
  // Total worst-case wait scales with the attempt budget actually in play,
  // not a single number picked independent of it.
  const effectiveTimeoutMs = config.maxAttempts * config.timeoutPerAttemptMs;

  // RCA (2026-07-24): same silent-swallow shape as channel-meta above --
  // .catch(() => []) discarded the actual error entirely. A specific video
  // repeatedly got zero comments across multiple post-fix analyses while
  // another video succeeded, and there was no way to tell "genuinely zero
  // comments" from "the fetch kept failing" without this.
  const fetchPromise = new MetadataScraper(env.YOUTUBE_API_KEY, env.RESIDENTIAL_PROXY_URL)
    .fetchComments(videoId, effectiveMaxResults, config.maxAttempts)
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[analyze-llm-stream] comments fetch failed for ${videoId}:`, message);
      Sentry.captureMessage(`comments fetch failed: ${videoId}`, {
        level: 'warning',
        tags: { operation: 'comments-fetch' },
        extra: { videoId, error: message, effectiveMaxResults },
      });
      return [];
    });
  const timeoutPromise = new Promise<VideoComment[]>((resolve) => setTimeout(() => resolve([]), effectiveTimeoutMs));
  const result = truncateComments(await Promise.race([fetchPromise, timeoutPromise]), config.maxPayloadBytes);

  if (result && cache) {
    cache.set(cacheKey, JSON.stringify(result), COMMENTS_CACHE_TTL).catch(() => {
      console.warn(`[analyze-llm-stream] comments cache SET failed for ${videoId}`);
    });
  }
  return result;
}

// Resolved server-side (CreateAnalysisUseCase) from CommentSamplingPort and
// forwarded per-request, same reasoning as commentsConfig/channelMetaConfig
// above -- this worker has no DB access (ADR 005) to compute a sample plan
// itself (needs the Settings Registry's comments.sampling.*/comments.cochran.*
// keys). Undefined means a stale/old client that never sent a plan; callers
// fall back to the flat single-page fetchCommentsCached above, preserving
// today's exact behavior for that case rather than guessing a plan.
interface CommentSamplePlan {
  targetSampleCount: number;
  likeBucketCount: number;
  recencyBucketCount: number;
}

// Must match the registry's seeded defaults
// (20260725110000_comments_sync_pool_fetch_settings.sql).
const SYNC_POOL_CONFIG_FALLBACK = { maxPages: 10, timeoutMs: 8000 };

/**
 * Builds a representative comment pool via paginated commentThreads.list
 * calls (Phase 3b's fetchCommentsPage), then applies the two-dimensional
 * stratified sampler (Phase 0, web/lib/services/comment-sampling.ts) to
 * select the final sample -- replaces the old flat single-page fetch, which
 * silently under-sampled any video with more comments than one page (the
 * root cause of the original grey/inconsistent comments bug this whole
 * engine was built to fix).
 *
 * Scope note (2026-07-25): bounded by syncPoolConfig (pages + time budget)
 * because this runs inside the synchronous dual-timeout streaming path
 * (ADR 002), not Tier 3's uncapped async queue. For very large comment
 * counts, the pool -- and therefore the stratification -- covers a bounded
 * prefix of the relevance-ordered set, not the true full population. This is
 * an honest, documented tradeoff, not a silent limitation: still far more
 * representative than the single page it replaces, and Tier 3 exists
 * specifically for callers that need the uncapped case.
 *
 * Also scoped out of this change: writing a `comment_sample_runs` audit row
 * for this synchronous path (Phase 1's schema supports it, Tier 3's async
 * path already does it) -- would need threading a new field through
 * PersistService's two call sites, the persist route's Zod schema, and
 * CreateAnalysisUseCase. Real additional surface area on an already-large
 * change; a UI-transparency nice-to-have, not the core fix. Left as a clean,
 * separately-reviewable follow-up rather than bundled in blind.
 */
async function fetchSampledCommentsCached(
  videoId: string,
  env: Pick<AnalysisEnv, "YOUTUBE_API_KEY" | "RESIDENTIAL_PROXY_URL">,
  cache: UpstashCacheAdapter | undefined,
  samplePlan: CommentSamplePlan,
  syncPoolConfig: typeof SYNC_POOL_CONFIG_FALLBACK,
  maxPayloadBytes: number,
): Promise<VideoComment[] | null> {
  if (!env.YOUTUBE_API_KEY) return null;
  if (samplePlan.targetSampleCount <= 0) return null;

  const cacheKey = `comments-sampled:${videoId}:${samplePlan.targetSampleCount}`;
  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached) as VideoComment[];
        } catch {
          console.debug(`[analyze-llm-stream] sampled-comments cache entry for ${videoId} is not JSON, ignoring`);
        }
      }
    } catch {
      console.warn(`[analyze-llm-stream] sampled-comments cache GET failed for ${videoId}, proceeding with fetch`);
    }
  }

  const scraper = new MetadataScraper(env.YOUTUBE_API_KEY, env.RESIDENTIAL_PROXY_URL);
  const deadline = Date.now() + syncPoolConfig.timeoutMs;
  const pool: VideoComment[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  try {
    while (pages < syncPoolConfig.maxPages && Date.now() < deadline) {
      const page = await scraper.fetchCommentsPage(videoId, { pageToken, maxResultsPerPage: 100 });
      pool.push(...page.comments);
      pages += 1;
      if (page.exhausted || !page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
  } catch (err) {
    // fetchCommentsPage already reports its own failures to Sentry; this
    // catch only guards against something unexpected escaping it so the pool
    // built so far (possibly empty) is still used rather than the whole
    // analysis failing over a best-effort enrichment field.
    console.warn(`[analyze-llm-stream] sampled-comments pool build threw for ${videoId}:`, err instanceof Error ? err.message : String(err));
  }

  if (pool.length === 0) return null;

  const effectiveTarget = Math.min(samplePlan.targetSampleCount, pool.length);
  const stratifiable: StratifiableComment[] = pool.map((comment, index) => ({ index, likeCount: comment.likeCount, publishedAt: comment.publishedAt }));
  const selectedIndices = stratifiedSampleIndices(stratifiable, effectiveTarget, samplePlan.likeBucketCount, samplePlan.recencyBucketCount);
  const sampled = selectedIndices.map((index) => pool[index]).filter((comment): comment is VideoComment => !!comment);
  const result = truncateComments(sampled, maxPayloadBytes);

  if (result && cache) {
    cache.set(cacheKey, JSON.stringify(result), COMMENTS_CACHE_TTL).catch(() => {
      console.warn(`[analyze-llm-stream] sampled-comments cache SET failed for ${videoId}`);
    });
  }
  return result;
}

async function fetchTranscriptIfMissing(
  transcript: string | undefined,
  videoId: string,
  env: Pick<AnalysisEnv, "RESIDENTIAL_PROXY_URL" | "DECODO_API_KEY" | "YOUTUBE_API_KEY">,
  channelId?: string,
  cache?: UpstashCacheAdapter,
  knownCommentCount?: number,
  commentsConfig: typeof COMMENTS_CONFIG_FALLBACK = COMMENTS_CONFIG_FALLBACK,
  channelMetaConfig: typeof CHANNEL_META_CONFIG_FALLBACK = CHANNEL_META_CONFIG_FALLBACK,
  commentSamplePlan?: CommentSamplePlan,
  syncPoolConfig: typeof SYNC_POOL_CONFIG_FALLBACK = SYNC_POOL_CONFIG_FALLBACK,
): Promise<ResolvedTranscript> {
  const isPlaceholder = transcript?.includes("Transcript unavailable for this video") || transcript?.includes("No captions available for this video");
  let segments: TranscriptSegment[] | undefined;
  let confirmedNoCaptions = false;

  // Fetched unconditionally (independent of transcript cache/fetch branches below) --
  // previously this only ran inside the transcript-missing branch, so any analysis
  // whose transcript already existed (the common case) never got channel metadata
  // at all, on top of it being fetched then immediately discarded after a log line.
  // Cached + time-bounded (see fetchChannelMetaCached) so it can never meaningfully
  // delay the transcript-critical path this function exists for.
  const channelMetaPromise: Promise<Record<string, unknown> | null> = fetchChannelMetaCached(channelId, env, cache, channelMetaConfig);
  // Sampled multi-page pool + stratified selection when the caller sent a
  // plan (CreateAnalysisUseCase, resolved from CommentSamplingPort); falls
  // back to the original flat single-page fetch for a stale/old client that
  // never sends one, preserving today's exact behavior for that case.
  const commentsPromise: Promise<VideoComment[] | null> = commentSamplePlan
    ? fetchSampledCommentsCached(videoId, env, cache, commentSamplePlan, syncPoolConfig, commentsConfig.maxPayloadBytes)
    : fetchCommentsCached(videoId, env, cache, knownCommentCount, commentsConfig);

  if (!transcript || transcript.trim().length === 0 || isPlaceholder) {
    console.info(`[analyze-llm-stream] Transcript missing or placeholder, attempting fetch for ${videoId}`);

    // L1 Redis transcript cache: 72h TTL (3-day compliance window)
    const CACHE_TTL = 259200;
    const cacheKey = `transcript:${videoId}`;

    if (cache) {
      try {
        const cached = await cache.get(cacheKey);
        if (cached && cached.trim().length > 0 && !cached.includes("Transcript unavailable") && !cached.includes("No captions available")) {
          console.info(`[analyze-llm-stream] Transcript cache HIT for ${videoId}`);
          const [channelMeta, comments] = await Promise.all([channelMetaPromise, commentsPromise]);
          // Cache values written pre-fix are plain transcript strings, not JSON —
          // parse defensively and fall back to flat text (no segments) for those.
          try {
            const parsed = JSON.parse(cached) as ResolvedTranscript;
            if (parsed && typeof parsed.transcript === 'string') {
              return { ...parsed, channelMeta, comments };
            }
          } catch (e) {
            console.debug(`[analyze-llm-stream] Cache entry for ${videoId} is not JSON — legacy plain-string entry, falling back to flat text`, e);
          }
          return { transcript: cached, channelMeta, comments };
        }
      } catch {
        console.warn(`[analyze-llm-stream] Transcript cache GET failed for ${videoId}, proceeding with fetch`);
      }
    }

    try {
      const extractor = new TranscriptExtractor(env.RESIDENTIAL_PROXY_URL, env.DECODO_API_KEY);
      const result = await extractor.fetch(videoId);
      // Gate on the explicit flag, not a substring match against the
      // placeholder text -- a new placeholder string was added for the
      // confirmed-no-captions case and a text-only check would silently
      // miss it, caching a placeholder as if it were real content.
      if (result.transcript && result.transcript.trim().length > 0 && !result.confirmedNoCaptions) {
        transcript = result.transcript;
        segments = result.segments;
        console.info(`[analyze-llm-stream] Fetch successful for ${videoId}`, { segmentCount: segments?.length ?? 0 });

        // Cache the successful transcript fetch, segments included so a cache HIT
        // on a repeat analysis still yields timed segments (see RCA above).
        if (cache) {
          const cachePayload: ResolvedTranscript = { transcript, segments };
          cache.set(cacheKey, JSON.stringify(cachePayload), CACHE_TTL).catch(() => {
            console.warn(`[analyze-llm-stream] Transcript cache SET failed for ${videoId}`);
          });
        }
      } else {
        confirmedNoCaptions = result.confirmedNoCaptions === true;
      }
    } catch (e) {
      console.error(`[analyze-llm-stream] Fetch failed for ${videoId}: ${e instanceof Error ? e.message : "Unknown"}`);
      if (!transcript) {
        transcript = "[Transcript unavailable for this video - content ingestion failed across all available sources]";
      }
    }
  }

  const [channelMeta, comments] = await Promise.all([channelMetaPromise, commentsPromise]);
  if (channelMeta) {
    console.info(`[analyze-llm-stream] Channel metadata enriched for ${channelId}`);
  }
  return { transcript, segments, channelMeta, comments, confirmedNoCaptions };
}

/** Build SSE streaming response with real-time analysis deltas, status updates, and atomic persist coordination. */
function buildStreamResponse(
  engine: ReasoningEnginePort,
  req: StreamRequest,
  signingKey: string,
  appUrl: string | undefined,
  httpConnSignal: AbortSignal | undefined,
  persistController: AbortController,
  waitUntil: (p: Promise<unknown>) => void,
  env: Pick<AnalysisEnv, "RESIDENTIAL_PROXY_URL" | "DECODO_API_KEY" | "YOUTUBE_API_KEY">,
  cache?: UpstashCacheAdapter,
): Response {
  const encoder = new TextEncoder();
  let finalText = "";
  let modelUsed = "";
  let settled = false;
  // Populated once fetchTranscriptIfMissing resolves inside the stream's start()
  // handler below; defaults to req.segments (almost always empty from the browser)
  // so an interrupted/timeout persist firing before resolution still has a value.
  let resolvedSegments: TranscriptSegment[] | undefined = req.segments;
  // Flat transcript text, kept alongside segments so the persist call can write
  // a `transcripts` row even when the video has a transcript but no timed
  // segments (e.g. it arrived pre-fetched from initial ingestion and
  // fetchTranscriptIfMissing's short-circuit never re-fetches with timing —
  // see RCA on fetchTranscriptIfMissing above). Chat grounding only needs the
  // text; segments are solely for timestamp-linked playback.
  let resolvedTranscriptText: string | undefined = req.transcript;
  // Channel-level metadata (subscriber count, channel description, etc.) --
  // previously fetched then discarded; now threaded through to persist so
  // chat grounding has more than just the video's own metadata to draw on.
  let resolvedChannelMeta: Record<string, unknown> | null = null;
  // Top relevance-ordered comments (author, text, publish date, likes) --
  // same enrichment purpose as channel metadata, fetched via the YouTube Data
  // API in fetchTranscriptIfMissing / fetchCommentsCached.
  let resolvedComments: VideoComment[] | null = null;

  const persistService = new PersistService();

  // Monitor client disconnect to settle early without aborting persist
  if (httpConnSignal && !httpConnSignal.aborted) {
    httpConnSignal.addEventListener(
      'abort',
      () => {
        if (!settled) {
          settled = true;
          console.debug('[analyze-llm-stream] Client disconnected, allowing persist to complete', { event: 'http-abort' });
        }
      },
      { once: true },
    );
  }

  let finishReason: string | undefined = undefined;
  // ADR 020 Phase 3: real OpenRouter usage/cost for the cost ledger, captured
  // from the same executeAndStream() result finishReason/modelUsed already
  // come from -- see result.tokensUsed/costUsd below.
  let tokensUsed: number | undefined;
  let costUsd: number | undefined;
  // ADR 020 Phase 2: set true when cancelController (declared below, inside
  // the stream's start() handler) actually fires. Declared here, at the
  // same outer scope as atomicPersist, so persist()'s closure -- built
  // before cancelController exists -- still sees the latest value at call
  // time via normal JS closure-over-outer-scope semantics.
  let wasCancelled = false;

  const atomicPersist = createAtomicPersist({
    hasContent: () => finalText.length > 0,
    persist: (status) => {
      const url = appUrl || "https://yt-intel.getmytestdrive.com";
      const persistParams = {
        analysisId: req.analysisId,
        videoId: req.videoId,
        finalText,
        modelUsed,
        finishReason,
        tokensUsed,
        costUsd,
        cancelled: wasCancelled,
        activeSecret: signingKey,
        appUrl: url,
        validate12D: (text: string) => engine.validate12D(text, req.dimensions?.length),
        chunkIndex: req.chunkIndex,
        totalChunks: req.totalChunks,
        segments: resolvedSegments,
        transcript: resolvedTranscriptText,
        channelMeta: resolvedChannelMeta,
        comments: resolvedComments,
      };

      // RCA (2026-07-22): this used to race EVERY persist call (including successful
      // 'completed' ones) against a 15s timeout that, on firing, sent a SECOND persist
      // with status forced to 'interrupted' -- silently downgrading a genuinely
      // successful generation to 'interrupted' whenever the network round-trip to
      // Vercel merely ran long (not a generation timeout, a persist-write timeout).
      // Vercel's chunk-completeness check (`FINAL_CHUNK_STATUS = 'completed'`) then
      // permanently excludes that dimension bundle, freezing billing_status at
      // 'failed' even though the content was real and complete (A6). PersistService
      // already retries the actual HTTP call internally (2 attempts, 10s AbortSignal
      // timeout each) -- this outer race added no protection for the success path,
      // only harm. Now only applied when we're already persisting as 'interrupted'
      // (the abort/disconnect path), where a bounded best-effort attempt before
      // giving up is the correct behavior.
      if (status !== 'interrupted') {
        return persistService.persist({ ...persistParams, status });
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const persistPromise = persistService.persist({ ...persistParams, status }).then((result) => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        return result;
      });

      const timeoutPromise = new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => {
          // Only reachable when persisting an already-'interrupted' outcome (the
          // client's SSE stream is done receiving deltas by this point, regardless
          // of how this persist call resolves) -- `settled` guards this module's own
          // persist bookkeeping, not the client stream, so no send({type:'error'})
          // belongs here.
          //
          // Reviewed false positive (PR #160, 2026-07-24): an automated
          // quality gate flags this as "timeout abort does not settle error
          // state." It's checked the wrong signal -- this timeout is a
          // bounded best-effort persist RETRY race, not the client-facing
          // stream timeout; the SSE response has already completed by the
          // time this can fire, so there is no client error state left to
          // settle. Do not "fix" this by adding a send({type:'error'}) call.
          settled = true;
          resolve(persistService.persist({ ...persistParams, status: 'interrupted' }));
        }, 15000);
      });

      return Promise.race([persistPromise, timeoutPromise]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
    },
    signal: persistController.signal,
    waitUntil,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch (err: any) {
          console.debug('[analyze-llm-stream] Client connection closed during enqueue:', err instanceof Error ? err.message : String(err));
        }
      };

      // Send immediate status frame, then fetch transcript asynchronously
      send({ type: "status", stage: "extracting", videoId: req.videoId });

      const [fetchResult] = await Promise.allSettled([fetchTranscriptIfMissing(
        req.transcript,
        req.videoId,
        { RESIDENTIAL_PROXY_URL: env.RESIDENTIAL_PROXY_URL, DECODO_API_KEY: env.DECODO_API_KEY, YOUTUBE_API_KEY: env.YOUTUBE_API_KEY },
        (req.metadata as { channelId?: string }).channelId,
        cache,
        (() => {
          const raw = (req.metadata as { commentCount?: string | number }).commentCount;
          const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
          return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
        })(),
        req.commentsConfig ?? COMMENTS_CONFIG_FALLBACK,
        req.channelMetaConfig ?? CHANNEL_META_CONFIG_FALLBACK,
        req.commentsSamplePlan,
        req.commentsSyncPoolConfig ?? SYNC_POOL_CONFIG_FALLBACK,
      )]);

      const resolvedTranscript = fetchResult.status === 'fulfilled' ? fetchResult.value.transcript : undefined;
      // Only overwrite the req.segments default when the fetch actually produced
      // timed segments — an interrupted fetch (rejected settle) must not wipe out
      // whatever the request already carried.
      if (fetchResult.status === 'fulfilled' && fetchResult.value.segments) {
        resolvedSegments = fetchResult.value.segments;
      }
      if (resolvedTranscript) {
        resolvedTranscriptText = resolvedTranscript;
      }
      if (fetchResult.status === 'fulfilled' && fetchResult.value.channelMeta) {
        resolvedChannelMeta = fetchResult.value.channelMeta;
      }
      if (fetchResult.status === 'fulfilled' && fetchResult.value.comments) {
        resolvedComments = fetchResult.value.comments;
      }

      if (!resolvedTranscript || !resolvedTranscript.trim() || resolvedTranscript.includes("Transcript unavailable") || resolvedTranscript.includes("content ingestion failed") || resolvedTranscript.includes("No captions available")) {
        // Distinguish "YouTube itself confirmed zero caption tracks"
        // (permanent -- a different video is the only fix) from "every
        // fallback tier failed to reach an answer" (transient -- retrying
        // this same video later often works). Same message for both was
        // actively misleading in the outage case.
        const confirmedNoCaptions = fetchResult.status === 'fulfilled' && fetchResult.value.confirmedNoCaptions === true;
        if (confirmedNoCaptions) {
          send({ type: "error", error: "No transcript available", code: "ERR_NO_TRANSCRIPT" });
        } else {
          send({ type: "error", error: "Transcript extraction temporarily unavailable", code: "ERR_TRANSCRIPT_PIPELINE_UNAVAILABLE" });
        }
        controller.close();
        return;
      }

      // Dedicated cancel signal (Phase 1, ADR 020) -- deliberately separate from
      // httpConnSignal. httpConnSignal fires on ANY disconnect (navigation away,
      // tab close, network drop) and must NOT abort generation (2026-07-29 fix,
      // preserves reattach-after-navigation). This one only fires when the user
      // explicitly clicks "stop" (POST /api/analyses/[id]/cancel sets a Redis
      // flag; stopAnalysis() in useSSEStream.ts calls it before aborting the
      // client's own fetch). Polled rather than pushed since there's no
      // persistent connection into a CF Worker isolate to push through.
      const cancelController = new AbortController();
      let pollingActive = true;
      if (cache) {
        waitUntil((async () => {
          while (pollingActive) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            if (pollingActive && (await cache.isCancelled(req.analysisId))) {
              console.info('[analyze-llm-stream] Explicit cancel flag consumed, aborting generation', { analysisId: req.analysisId });
              cancelController.abort();
              break;
            }
          }
        })());
      } else {
        // Same graceful-degrade convention this file already uses for every
        // other optional Redis feature when UPSTASH_REDIS_REST_URL/TOKEN
        // aren't configured -- but unlike a cache-miss, this one silently
        // disables a safety feature (spend stops on cancel), so it gets a
        // log the others don't.
        console.warn('[analyze-llm-stream] No cache adapter configured -- explicit cancellation will not stop this generation', { analysisId: req.analysisId });
      }

      try {
        send({ type: "status", stage: "starting", videoId: req.videoId });

        const result = await engine.executeAndStream(
          {
            // resolvedChannelMeta (subscriberCount/channelVideoCount/channelPublishedAt,
            // resolved above before this call) was previously only threaded to
            // the persist call, never into the prompt itself -- the model asked
            // for these fields explicitly (Dimension 2.3/11.1/11.6) and got
            // Insufficient Data every time because they never arrived here.
            metadata: { ...req.metadata, ...(resolvedChannelMeta || {}) },
            transcript: resolvedTranscript,
            persona: req.persona,
            timezone: req.timezone,
            dimensions: req.dimensions,
          },
          {
            onDelta: (delta: string) => {
              finalText += delta;
              send({ type: "delta", content: delta });
            },
            onFragment: (fragment: any) => send(fragment as unknown as Record<string, unknown>),
            onStatus: (statusEvent: StreamStatusEvent) => {
              if (statusEvent.stage === "model" && statusEvent.model) {
                modelUsed = statusEvent.model;
              }
              send({ type: "status", ...statusEvent });
            },
          },
          // httpConnSignal is deliberately NOT forwarded here (2026-07-29 fix,
          // see comment above buildStreamResponse's cancel-poll setup) -- a
          // client disconnect from navigation/tab-close must not kill
          // generation, only an explicit cancel (cancelController) does.
          cancelController.signal,
        );

        pollingActive = false;
        wasCancelled = cancelController.signal.aborted;
        finishReason = result.finishReason;
        tokensUsed = result.tokensUsed;
        costUsd = result.costUsd;

        if (!result.produced && !result.finalText) {
          send({ type: "error", error: "All models in cascade failed to produce output" });
          controller.close();
          return;
        }

        send({ type: "complete", model: result.modelUsed, valid: result.valid, videoId: req.videoId, analysisId: req.analysisId });
      } catch (error) {
        // An abort can propagate as a thrown error rather than a clean
        // return depending on how deep it unwinds through LLMCascade's
        // fetch chain -- check here too, not just the success path above.
        if (cancelController.signal.aborted) wasCancelled = true;
        send({ type: "error", error: error instanceof Error ? error.message : "stream failed" });
      } finally {
        pollingActive = false;
        if (!settled) {
          // Intentionally not awaited: waitUntil keeps this alive in the background;
          // this stream doesn't relay persist status to the client (unlike chat-stream.ts).
          void atomicPersist.flush();
        }
        persistController.abort();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

const analysis = new Hono<{ Bindings: AnalysisEnv }>();

analysis.post("/analyze-llm", async (c) => {
  const request = (await c.req.json()) as AnalysisRequest;

  if (!request.videoId || !request.transcript || !request.metadata) {
    return c.json({ success: false, error: "Missing required fields" }, 400);
  }

  try {
    const apiKey = c.env.OPENROUTER_API_KEY;
    const upstashUrl = c.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = c.env.UPSTASH_REDIS_REST_TOKEN;

    if (!apiKey) {
      console.error("[analyze-llm] Server misconfigured: Missing router credentials");
      return c.json({ success: false, error: "Server misconfigured" }, 500);
    }

    if (!upstashUrl || !upstashToken) {
      console.warn("[analyze-llm] Upstash not configured, proceeding without caching");
    }

    const cache =
      upstashUrl && upstashToken
        ? new UpstashCacheAdapter({ url: upstashUrl, token: upstashToken })
        : undefined;
    const promptConfig =
      upstashUrl && upstashToken
        ? new WorkerPromptConfigAdapter({ url: upstashUrl, token: upstashToken })
        : undefined;
    const engine: ReasoningEnginePort = new ReasoningEngine(new PromptBuilder(promptConfig), new LLMCascade(apiKey), new ValidationService(), cache);

    const result = await engine.execute({
      metadata: request.metadata,
      transcript: request.transcript,
      persona: request.persona,
      timezone: request.timezone,
      videoId: request.videoId,
      systemPrompt: request.systemPrompt,
    });

    if (!result.success) {
      return c.json({ success: false, error: result.error }, 502);
    }

    return c.json({
      success: true,
      analysis: result.analysis,
      model: result.model,
      cached: result.cached,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[analyze-llm] Error:", message);

    return c.json(
      {
        success: false,
        error: message,
      },
      500,
    );
  }
});

analysis.post("/analyze-llm-stream", async (c) => {
  const req = (await c.req.json()) as StreamRequest;
  const apiKey = c.env.OPENROUTER_API_KEY;

  if (!req.videoId || !req.analysisId || !req.metadata || !req.sig || !req.exp) {
    const missing = [];
    if (!req.videoId) missing.push("videoId");
    if (!req.analysisId) missing.push("analysisId");
    if (!req.metadata) missing.push("metadata");
    if (!req.sig) missing.push("sig");
    if (!req.exp) missing.push("exp");
    return c.json({ error: `Missing required fields: ${missing.join(", ")}` }, 400);
  }

  if (!isValidAppUrl(req.appUrl, c.env.APP_URL, c.env.ALLOWED_APP_ORIGINS, isProductionEnv(c.env))) {
    console.warn("[analyze-llm-stream] Blocked untrusted appUrl callback redirect:", req.appUrl);
    return c.json({ error: "Invalid appUrl callback destination" }, 400);
  }

  if (!c.env.STREAM_HMAC_SECRET || !apiKey) {
    console.error("[analyze-llm-stream] Server misconfigured: missing signature key or router credentials");
    return c.json({ error: "Server misconfigured" }, 500);
  }

  const { isValid: isTokenValid, secret: signingKey, msg } = await verifyStreamToken(req.videoId, req.analysisId, req.exp, req.sig, req.models, c.env);

  if (!isTokenValid) {
    // `msg` is "" only on the expiry early-return; otherwise it's the reconstructed
    // message from the signature-mismatch path.
    const reason = msg === "" ? "expired" : "invalid_signature";
    // Full diagnostics go to SERVER logs only — never the client response, which
    // previously echoed the internal msg (analysisId/models/exp) + sig to any
    // caller (the prod worker leaked this because NODE_ENV is unset, so the old
    // NODE_ENV !== "production" guard was always true). Secret fingerprints let
    // ops compare the Worker's secrets against the Vercel signer's without
    // logging the secrets themselves.
    const keyFpPrimary = await secretFingerprint(c.env.STREAM_HMAC_SECRET);
    const keyFpFallback = await secretFingerprint(c.env.DEV_HMAC_SECRET);
    console.warn("[analyze-llm-stream] stream signature rejected", {
      reason,
      videoId: req.videoId,
      analysisId: req.analysisId,
      keyFpPrimary,
      keyFpFallback,
    });
    return c.json({ error: "Invalid token", reason }, 401);
  }

  const upstashUrl = c.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = c.env.UPSTASH_REDIS_REST_TOKEN;
  const cache =
    upstashUrl && upstashToken
      ? new UpstashCacheAdapter({ url: upstashUrl, token: upstashToken })
      : undefined;
  const promptConfig =
    upstashUrl && upstashToken
      ? new WorkerPromptConfigAdapter({ url: upstashUrl, token: upstashToken })
      : undefined;

  const engine: ReasoningEnginePort = new ReasoningEngine(new PromptBuilder(promptConfig), new LLMCascade(apiKey, req.models, req.cascade, req.maxOutputTokens, req.userId), new ValidationService(), cache);

  const persistController = new AbortController();
  const httpConnSignal = c.req.raw['signal'];

  return buildStreamResponse(engine, req, signingKey, req.appUrl || c.env.APP_URL, httpConnSignal, persistController, (p) => c.executionCtx.waitUntil(p), c.env, cache);
});

export default analysis;
