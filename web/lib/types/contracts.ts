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
}).refine(
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

export interface WorkerStreamRequest {
  videoId: string;
  analysisId: string;
  transcript: string;
  segments?: Array<{ start: number; duration: number; text: string }>;
  metadata: AnalysisJobMetadata;
  persona: string;
  timezone: string;
  // Per-tier model cascade (app_settings); bound into the stream token's HMAC.
  models?: string[];
  sig: string;
  exp: number;
  appUrl?: string;
  dimensions?: number[];
  chunkIndex?: number;
  totalChunks?: number;
  commentsConfig?: CommentsFetchConfig;
  channelMetaConfig?: ChannelMetaFetchConfig;
}

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
