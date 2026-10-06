import { z } from 'zod';
import { VALID_PERSONAS } from './persona';

// ─── Video Validation ───────────────────────────────────────────────────────
/**
 * Zod schema for YouTube video IDs.
 * Validates 11-character alphanumeric IDs (letters, digits, hyphens, underscores).
 */
export const VideoIdSchema = z.string().regex(
  /^[a-zA-Z0-9_-]{11}$/,
  'Invalid video ID format'
);

/**
 * Zod schema for YouTube video URLs.
 * Normalizes URLs to standard format and validates they point to YouTube.
 * Handles shorts, live streams, and embed URLs by extracting video ID.
 */
export const VideoUrlSchema = z.string()
  .transform((val) => {
    // Normalize URLs: add https:// if missing, handle all YouTube formats
    let normalized = val.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`;
    }
    return normalized;
  })
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return ['youtube.com', 'www.youtube.com', 'youtu.be'].includes(parsed.hostname);
      } catch {
        return false;
      }
    },
    'Invalid YouTube URL'
  )
  .transform((val) => {
    // Auto-transform YouTube shorts/live/embed to standard watch format at perimeter
    try {
      const parsed = new URL(val);
      let videoId = '';

      if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.split('/')[2] ?? '';
      } else if (parsed.pathname.startsWith('/live/')) {
        videoId = parsed.pathname.split('/')[2] ?? '';
      } else if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.split('/')[2] ?? '';
      } else if (parsed.pathname.startsWith('/v/')) {
        videoId = parsed.pathname.split('/')[2] ?? '';
      } else if (parsed.hostname === 'youtu.be') {
        videoId = parsed.pathname.slice(1);
      } else {
        videoId = parsed.searchParams.get('v') ?? '';
      }

      if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
      return val;
    } catch {
      return val;
    }
  });

// ─── Analysis ────────────────────────────────────────────────────────────────
/**
 * Zod schema for analysis creation requests.
 * Validates YouTube URL, timezone, persona, and refresh preferences.
 */
export const AnalysisCreateSchema = z.object({
  url: VideoUrlSchema,
  timezone: z
    .string()
    .trim()
    .refine(
      (tz) => {
        try {
          Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      'Invalid IANA timezone'
    )
    .default('Africa/Cairo')
    .describe('IANA timezone for timestamps'),
  persona: z.enum(VALID_PERSONAS).optional().describe('Target persona (creator=Content Creator, indieMaker=Indie Maker, consultant=Consultant, researcher=Researcher, productManager=Product Manager)'),
  forceRefresh: z.boolean().optional().default(false).describe('Force cache bypass and generate fresh analysis'),
});

// ─── Checkout ────────────────────────────────────────────────────────────────
/**
 * Zod schema for checkout session creation.
 * Validates success and cancel URLs are on the same domain as the app.
 */
export const CheckoutSchema = z.object({
  successUrl: z.string().url('Invalid success URL'),
  cancelUrl: z.string().url('Invalid cancel URL'),
  // Real plan + billing interval the user selected on the pricing table.
  // Required (not defaulted) so the server can never silently assume
  // "pro"/"month" for a request that actually meant something else -- see
  // ADR/Cubic P0 finding 2026-08-18: the yearly toggle previously changed
  // display only and never reached checkout at all.
  plan: z.enum(['founder', 'light', 'pro', 'max']).describe('Selected pricing tier'),
  interval: z.enum(['once', 'month', 'year']).describe('Selected billing interval'),
}).refine(
  (data) => {
    // Founder tier is exclusively a one-time purchase
    if (data.plan === 'founder') {
      return data.interval === 'once';
    }
    // Subscription tiers (Light / Pro / Max) must be recurring (month or year)
    return data.interval === 'month' || data.interval === 'year';
  },
  { message: 'Invalid plan and interval combination. Founder tier is once only; subscription tiers must be monthly or yearly.' }
).refine(
  (data) => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!appUrl) return false;
    try {
      const appOrigin = new URL(appUrl).origin;
      const successOrigin = new URL(data.successUrl).origin;
      const cancelOrigin = new URL(data.cancelUrl).origin;
      return successOrigin === appOrigin && cancelOrigin === appOrigin;
    } catch {
      return false;
    }
  },
  { message: 'URLs must be on this domain' }
);

// ─── Analysis Job Contract (bouncer → client → worker) ────────────────────────
/**
 * Zod schema for analysis job metadata.
 * Contains YouTube video metadata returned by bouncer and forwarded to worker.
 * Used as a contract between /api/analyses, client useSSEStream, and Cloudflare Worker.
 */
export const AnalysisJobMetadataSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channelTitle: z.string(),
  // RCA (2026-07-25): never existed in this schema, so buildJobMetadata()
  // silently dropped the channelId that WAS correctly scraped -- job.metadata
  // (client) and req.metadata (forwarded back to the worker's /analyze-llm-stream)
  // both lost it, so fetchChannelMetaCached always received channelId=undefined,
  // always short-circuited to null, and the CHANNEL META history badge could
  // never turn green regardless of whether the channel actually had metadata.
  channelId: z.string().optional(),
  publishedAt: z.string(),
  duration: z.number(),
  viewCount: z.string(),
  likeCount: z.string(),
  commentCount: z.string(),
  description: z.string().optional(),
});

/**
 * Type for analysis job metadata extracted from YouTube API.
 * @property videoId - YouTube video ID
 * @property title - Video title
 * @property channelTitle - Channel/creator name
 * @property publishedAt - Publication date
 * @property duration - Video duration in seconds
 * @property viewCount - View count (as string for compatibility)
 * @property likeCount - Like count (as string for compatibility)
 * @property commentCount - Comment count (as string for compatibility)
 * @property description - Optional video description
 */
export type AnalysisJobMetadata = z.infer<typeof AnalysisJobMetadataSchema>;

/**
 * Contract payload for streaming analysis requests to Cloudflare Worker.
 * Synchronizes with worker/src/worker.ts StreamRequest interface.
 * Missing or incorrectly typed fields cause compile errors, preventing runtime failures.
 * @property videoId - YouTube video ID
 * @property analysisId - Unique analysis request ID
 * @property transcript - Full video transcript
 * @property metadata - YouTube video metadata
 * @property persona - Selected analysis persona
 * @property timezone - User's timezone
 * @property models - Optional model cascade override
 * @property sig - HMAC signature for token validation
 * @property exp - Token expiration timestamp
 * @property appUrl - Optional app URL for streaming origin
 * @property dimensions - Optional dimension indices to process
 * @property chunkIndex - Current chunk index in multi-chunk analysis
 * @property totalChunks - Total number of chunks for this analysis
 */
/**
 * Comments-grounding fetch tunables (Wave D2, settings registry
 * `chat.comments.*`). Resolved server-side by CreateAnalysisUseCase (Vercel
 * has DB access; the worker does not, per ADR 005) and forwarded so the
 * worker never hardcodes these -- the worker sizes the actual request
 * against the video's known comment count on top of this config, it doesn't
 * use maxResults blindly.
 */
export interface CommentsFetchConfig {
  maxResults: number;
  maxAttempts: number;
  timeoutPerAttemptMs: number;
  maxPayloadBytes: number;
}

/**
 * Channel-metadata fetch tunables (settings registry `chat.channelMeta.*`).
 * Same reasoning as CommentsFetchConfig -- resolved server-side and
 * forwarded, never hardcoded worker-side. RCA (2026-07-24): these were two
 * hardcoded worker constants (CHANNEL_META_TIMEOUT_MS, MAX_CHANNEL_META_BYTES)
 * whose silent-drop paths had no Sentry telemetry, making the "Channel Meta"
 * history chip consistently grey with zero corresponding issues anywhere.
 */
export interface ChannelMetaFetchConfig {
  timeoutMs: number;
  maxPayloadBytes: number;
}

/**
 * Resolved sample plan for the live synchronous Tier 0-2 comments fetch
 * (CommentSamplingPort.planSample, resolved by CreateAnalysisUseCase and
 * forwarded -- worker has no DB access, ADR 005). Replaces the old flat
 * single-page comment fetch with a stratified sample over a real
 * multi-page pool. See worker/src/routes/analysis.ts#fetchSampledCommentsCached.
 */
export interface CommentsSamplePlanConfig {
  targetSampleCount: number;
  likeBucketCount: number;
  recencyBucketCount: number;
}

/** Bounds the pool-build loop (pages + time budget) for the plan above -- not the sample size itself. */
export interface CommentsSyncPoolConfig {
  maxPages: number;
  timeoutMs: number;
}

export interface WorkerStreamRequest {
  videoId: string;
  analysisId: string;
  // Forwarded to OpenRouter's `user` field (worker-side, LLMCascade.ts) for
  // abuse/security correlation -- see worker/src/routes/analysis.ts's
  // StreamRequest.userId. Optional; never used for authorization.
  userId?: string;
  transcript: string;
  segments?: Array<{ start: number; duration: number; text: string }>;
  metadata: AnalysisJobMetadata;
  persona: string;
  timezone: string;
  // Per-tier model cascade (app_settings); bound into the stream token's HMAC.
  models?: string[];
  // Full registry-resolved cascade (2026-07-25, includes providerOrder per tier)
  // -- see CreateAnalysisUseCase's resolveAnalysisCascade() and StreamRequest.cascade
  // in worker/src/routes/analysis.ts. ADR 041: resolve time also stamps per-tier
  // dispatch capabilities (maxOutputTokens, requiresProviderOrder) so the worker's
  // dispatch code is model-agnostic — no inline model-ID comparisons.
  cascade?: Array<{ model: string; name: string; cost?: number; providerOrder?: string[]; maxOutputTokens?: number; requiresProviderOrder?: boolean }>;
  // Registry-resolved (2026-07-25) -- see CreateAnalysisUseCase and LLMCascade.ts's
  // MAX_TOKENS_FALLBACK doc comment for the production-outage RCA behind this field.
  maxOutputTokens?: { haiku: number; default: number };
  // Registry-resolved (2026-08-07) -- see CreateAnalysisUseCase and LLMCascade.ts's
  // timeoutMs doc comment for the RCA behind this field (a long-video timeout
  // incident traced to a hardcoded value that falsely assumed a non-existent
  // Cloudflare platform ceiling).
  llmCascadeTimeoutMs?: number;
  // Registry-resolved (2026-08-07, analysis.llmCascade.handshakeTimeoutMs) --
  // sibling of llmCascadeTimeoutMs, per-model connection-handshake budget.
  llmCascadeHandshakeTimeoutMs?: number;
  // Registry-resolved (2026-09-25, analysis.promptCaching.enabled) --
  // Anthropic prompt caching via OpenRouter cache_control on the bundles'
  // shared prefix. Kill switch; worker defaults to enabled when absent.
  promptCaching?: boolean;
  // Registry-resolved (2026-09-25, analysis.llmCascade.cacheWarmTimeoutMs) --
  // client-side bounded wait before bundles 2-5 start (cache-warm stagger),
  // consumed in useSSEStream, never forwarded to the worker.
  cacheWarmTimeoutMs?: number;
  /** Registry-resolved prompt transcript char budget (analysis.transcriptBudgetChars). */
  transcriptBudgetChars?: number;
  /** R3b Phase 2.6: seconds between real [HH:MM:SS] prompt markers (analysis.jev.timeMarkerIntervalSeconds). */
  timeMarkerIntervalSeconds?: number;
  /** Optional existing payload from prior partial analysis for retry synthesis hydration (Dimension 11). */
  prior_payload?: Record<string, unknown>;
  /** R1d: registry-resolved byte cap for the worker's prior_payload boundary guard (web/lib/config/prior-payload.ts). */
  priorPayloadMaxBytes?: number;
  /** R2b: Vercel signature over the server-loaded prior_payload (web/lib/config/projective-context.ts). */
  contextSig?: string;
  contextExp?: number;
  sig: string;
  exp: number;
  /** R3b 2.2: v2 token cells + bundle partition for the worker's dual-verify (absent = v1). */
  tokenVersion?: 1 | 2;
  streamCount?: number;
  jevChunkIndex?: number;
  jevChunkCount?: number;
  bundleList?: number[][];
  /** R3b 2.3.5: v2 token slice bounds and hash. */
  sliceSha256?: string;
  startWord?: number;
  endWord?: number;
  /** R3b 2.3 (P1): Jev semantic-chunk plan forwarded to the worker (absent = no plan / K=1). */
  jevPlan?: JevPlanEvent;
  appUrl?: string;
  dimensions?: number[];
  chunkIndex?: number;
  totalChunks?: number;
  commentsConfig?: CommentsFetchConfig;
  channelMetaConfig?: ChannelMetaFetchConfig;
  commentsSamplePlan?: CommentsSamplePlanConfig;
  commentsSyncPoolConfig?: CommentsSyncPoolConfig;
}

/**
 * R3b 2.3 (P1): Shared SSOT for the Jev semantic-chunk plan (ADR 029 v2
 * relay). Two carriers share this shape:
 * - job.jevPlan (CreateAnalysisUseCase): server-computed plan at job creation;
 *   includes `estimateCents` (kept optional here so ONE schema validates both
 *   carriers).
 * - worker SSE `event: plan` frame: same fields plus the `v`/`source` envelope.
 * safeParse only -- never cast. Malformed/absent plan ⇒ K=1 fallback.
 */
export const JevPlanCellSchema = z.object({
  jevChunkIndex: z.number().int().min(0),
  chunkIndex: z.number().int().min(0),
  startWord: z.number().int().min(0),
  endWord: z.number().int().min(0),
  sha256: z.string().min(1),
});

export const JevPlanEventSchema = z
  .object({
    // Worker SSE frames carry the envelope keys (#392: {v:1,source,...plan}).
    v: z.literal(1).optional(),
    source: z.enum(['inline', 'worker']).optional(),
    K: z.number().int().min(1),
    streamCount: z.number().int().min(1),
    cells: z.array(JevPlanCellSchema),
    estimateCents: z.number().optional(),
    truncatedFallback: z.boolean(),
    // T3 (10X PR scan): A6 budget context the worker re-checks before a
    // slice-fallback full-transcript re-run. Optional — legacy plans (and the
    // SSE plan event, which strips them for wire compatibility) omit both.
    costCapCents: z.number().optional(),
    fullTranscriptCallCents: z.number().optional(),
  })
  .strict();

export type JevPlanEvent = z.infer<typeof JevPlanEventSchema>;

// ─── Inferred Types ──────────────────────────────────────────────────────────
/**
 * Analysis creation input type inferred from AnalysisCreateSchema.
 * Contains validated URL, timezone, persona, and refresh preferences.
 */
export type AnalysisCreateInput = z.infer<typeof AnalysisCreateSchema>;

/**
 * Checkout input type inferred from CheckoutSchema.
 * Contains validated success and cancel URLs on app domain.
 */
export type CheckoutInput = z.infer<typeof CheckoutSchema>;

// ─── Epistemic Schism / Part A: Grounded Extraction ──────────────────────────
export const ExtractedClaimSchema = z.object({
  id: z.string().min(1),
  speaker: z.string().optional(),
  timestampRange: z.tuple([z.number().min(0), z.number().min(0)]),
  verbatimQuote: z.string().min(1),
  atomicAssertion: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const GroundedExtractionMetadataSchema = z.object({
  speakerCount: z.number().int().min(0),
  durationSeconds: z.number().min(0),
  classification: z.enum(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']),
});

export const GroundedExtractionPayloadSchema = z.object({
  claims: z.array(ExtractedClaimSchema),
  unknowns: z.array(z.string()),
  metadata: GroundedExtractionMetadataSchema,
});

export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;
export type GroundedExtractionMetadata = z.infer<typeof GroundedExtractionMetadataSchema>;
export type GroundedExtractionPayload = z.infer<typeof GroundedExtractionPayloadSchema>;
