import * as Sentry from '@sentry/cloudflare';
import { reconstructMarkdown, extractJsonPayload } from './MarkdownReconstructor';
import { UCISPayloadSchema, ChunkPayloadSchema } from './ZodSchemas';
import { signBoundContent } from '../crypto';

/**
 * How long a signed persist body stays valid. Generous (10 min) to absorb
 * retries, ctx.waitUntil scheduling delay, and any Cloudflare↔Vercel clock
 * skew, while still bounding the replay window. Must be tolerated by the
 * Vercel-side verifyContentSig() expiry check.
 */
const PERSIST_SIG_TTL_MS = 600_000;

export interface PersistOptions {
  analysisId: string;
  videoId: string;
  finalText: string;
  modelUsed: string;
  finishReason?: string;
  status: 'completed' | 'interrupted';
  // ADR 020 Phase 2: explicit "the user clicked stop" signal, threaded
  // through end-to-end rather than inferred from dimension-completeness
  // content heuristics on the Vercel side -- a user can cancel AFTER most
  // dimensions already streamed, which would otherwise look "valid" by
  // content alone and get silently marked 'completed'.
  cancelled?: boolean;
  // ADR 020 Phase 3: real OpenRouter usage/cost, not signed/verified since
  // billing decisions never depend on these (billing_status is driven by
  // valid/cancelled only) -- this is accounting telemetry, not an integrity-
  // sensitive field like `cancelled` was (see canonical/signBoundContent below).
  tokensUsed?: number;
  costUsd?: number;
  // Exact traceability (2026-08-02 directive): OpenRouter's own
  // generation id, so a cost/billing question can be resolved against
  // OpenRouter's own record, not a timestamp-based guess.
  generationId?: string;
  activeSecret: string;
  appUrl: string;
  validate12D: (text: string) => boolean;
  chunkIndex?: number;
  totalChunks?: number;
  segments?: Array<{ start: number; duration: number; text: string }>;
  transcript?: string;
  channelMeta?: Record<string, unknown> | null;
  comments?: Array<{ author: string; text: string; publishedAt: string; likeCount: number }> | null;
  chapters?: Array<{ idx: number; start_seconds: number; end_seconds: number; label: string }> | null;
}

const rawFetch = fetch;

/** Schema selector: picks chunk or full schema based on chunk presence. Returns null if no schema matches. */
function selectPersistSchema(isChunk: boolean): typeof ChunkPayloadSchema | typeof UCISPayloadSchema | null {
  return isChunk ? ChunkPayloadSchema : UCISPayloadSchema;
}

/**
 * PersistService — Dual-write persistence via S2S HTTP postback.
 *
 * Extracts JSON payload from final text, validates against UCIS/Chunk schema,
 * reconstructs markdown, computes HMAC content signature, and delivers to
 * the Vercel `/api/analyses/persist` endpoint with retry logic.
 */
export class PersistService {
  /** Execute full persist cycle: extract → validate → sign → deliver. */
  async persist(options: PersistOptions): Promise<boolean> {
    let markdown = options.finalText;
    let jsonPayload: Record<string, unknown> | null = null;

    const extracted = extractJsonPayload(options.finalText, options.finishReason);

    if (extracted) {
      const isChunk = options.chunkIndex !== undefined;
      const schema = selectPersistSchema(isChunk);
      if (!schema) return false;

      const result = schema.safeParse(extracted);
      if (result.success) {
        jsonPayload = result.data as unknown as Record<string, unknown>;
      } else {
        console.error('[persist] Zod validation failed:', result.error.format());
        Sentry.captureMessage('PersistService: Zod validation failed', {
          level: 'error',
          contexts: {
            persist: {
              analysisId: options.analysisId,
              videoId: options.videoId,
              chunkIndex: options.chunkIndex,
              totalChunks: options.totalChunks,
              zodError: result.error.format(),
            },
          },
        });
      }
    }

    if (jsonPayload) {
      try {
        markdown = reconstructMarkdown(jsonPayload);
      } catch (error) {
        console.error('[persist] reconstructMarkdown failed:', error);
        markdown = options.finalText;
      }
    }

    const valid = options.validate12D(markdown);
    // cancelled/tokensUsed/costUsd are all included here (ADR 020 Phase 2/3
    // security fix) -- cancelled decides billing_status server-side
    // (route.ts: `cancelled ? 'cancelled' : ...`), and tokensUsed/costUsd
    // feed the admin cost ledger. All three must be covered by the
    // signature like markdown/payload, not sent as plain unsigned fields an
    // attacker who observes one legitimately-signed request could alter on
    // a replay within the signature's TTL window (cubic review, PR #175).
    const canonical = JSON.stringify({
      markdown,
      payload: jsonPayload,
      cancelled: options.cancelled ?? false,
      tokensUsed: options.tokensUsed ?? null,
      costUsd: options.costUsd ?? null,
      generationId: options.generationId ?? null,
    });
    // Bind the signature to this analysis id and an expiry so an observed persist
    // body can't be replayed indefinitely or against a different analysis. Must
    // stay in lockstep with verifyContentSig() on the Vercel side.
    const exp = Date.now() + PERSIST_SIG_TTL_MS;
    const contentSig = await signBoundContent(options.activeSecret, 'persist', options.analysisId, exp, canonical);

    return this._attemptPersist({
      ...options,
      markdown,
      jsonPayload,
      valid,
      contentSig,
      exp,
    });
  }

  /** Deliver payload to persist endpoint with retry. Returns true if at least one attempt succeeded. */
  async _attemptPersist(params: {
    analysisId: string;
    videoId: string;
    finalText: string;
    markdown: string;
    jsonPayload: Record<string, unknown> | null;
    modelUsed: string;
    status: 'completed' | 'interrupted';
    cancelled?: boolean;
    tokensUsed?: number;
    costUsd?: number;
    generationId?: string;
    activeSecret: string;
    appUrl: string;
    valid: boolean;
    contentSig: string;
    exp: number;
    chunkIndex?: number;
    totalChunks?: number;
    segments?: Array<{ start: number; duration: number; text: string }>;
    transcript?: string;
    channelMeta?: Record<string, unknown> | null;
    comments?: Array<{ author: string; text: string; publishedAt: string; likeCount: number }> | null;
    chapters?: Array<{ idx: number; start_seconds: number; end_seconds: number; label: string }> | null;
  }): Promise<boolean> {
    const maxRetries = 2;
    for (let tryIndex = 0; tryIndex <= maxRetries; tryIndex++) {
      try {
        const persistRes = await rawFetch(`${params.appUrl}/api/analyses/persist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            analysisId: params.analysisId,
            videoId: params.videoId,
            markdown: params.markdown,
            payload: params.jsonPayload,
            model: params.modelUsed,
            valid: params.valid,
            contentSig: params.contentSig,
            exp: params.exp,
            status: params.status,
            cancelled: params.cancelled,
            tokensUsed: params.tokensUsed,
            costUsd: params.costUsd,
            generationId: params.generationId,
            chunkIndex: params.chunkIndex,
            totalChunks: params.totalChunks,
            segments: params.segments,
            transcript: params.transcript,
            channelMeta: params.channelMeta,
            comments: params.comments,
            chapters: params.chapters,
          }),
        });
        if (persistRes.ok) return true;
        console.warn(`[persist] ${params.status} persist returned ${persistRes.status}, retrying...`);
      } catch (e) {
        console.error(`[persist] ${params.status} persist attempt ${tryIndex + 1}/${maxRetries + 1} failed`, e);
      }
      if (tryIndex < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (tryIndex + 1)));
      }
    }
    Sentry.captureMessage('PersistService: persist exhausted all retries', {
      level: 'error',
      contexts: {
        persist: {
          analysisId: params.analysisId,
          videoId: params.videoId,
          status: params.status,
          chunkIndex: params.chunkIndex,
          totalChunks: params.totalChunks,
          maxRetries,
        },
      },
    });
    return false;
  }

  /** Settlement path for failed/interrupted analyses. Skips schema map lookup — always uses ChunkPayloadSchema. */
  async settleAnalysis(options: {
    analysisId: string;
    videoId: string;
    finalText: string;
    modelUsed: string;
    activeSecret: string;
    appUrl: string;
    validate12D: (text: string) => boolean;
    status: 'failed' | 'interrupted';
    segments?: Array<{ start: number; duration: number; text: string }>;
    transcript?: string;
    channelMeta?: Record<string, unknown> | null;
    comments?: Array<{ author: string; text: string; publishedAt: string; likeCount: number }> | null;
    finishReason?: string;
  }): Promise<void> {
    let markdown = options.finalText;
    let jsonPayload: Record<string, unknown> | null = null;

    const extracted = extractJsonPayload(options.finalText, options.finishReason);
    if (extracted) {
      const result = ChunkPayloadSchema.safeParse(extracted);
      if (result.success) {
        jsonPayload = result.data as unknown as Record<string, unknown>;
      } else {
        console.error('[settle] Zod validation failed:', result.error.format());
        Sentry.captureMessage('PersistService: settleAnalysis Zod validation failed', {
          level: 'error',
          contexts: {
            settle: {
              analysisId: options.analysisId,
              videoId: options.videoId,
              status: options.status,
              zodError: result.error.format(),
            },
          },
        });
      }
    }

    if (jsonPayload) {
      try {
        markdown = reconstructMarkdown(jsonPayload);
      } catch (error) {
        console.error('[settle] reconstructMarkdown failed:', error);
        markdown = options.finalText;
      }
    }

    const valid = options.validate12D(markdown);
    const canonical = JSON.stringify({ markdown, payload: jsonPayload });
    const exp = Date.now() + PERSIST_SIG_TTL_MS;
    const contentSig = await signBoundContent(options.activeSecret, 'persist', options.analysisId, exp, canonical);

    const maxRetries = 2;
    for (let tryIndex = 0; tryIndex <= maxRetries; tryIndex++) {
      try {
        await rawFetch(`${options.appUrl}/api/analyses/persist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            analysisId: options.analysisId,
            videoId: options.videoId,
            markdown,
            payload: jsonPayload,
            model: options.modelUsed,
            valid,
            contentSig,
            exp,
            status: options.status,
            segments: options.segments,
            transcript: options.transcript,
            channelMeta: options.channelMeta,
            comments: options.comments,
          }),
        });
        return;
      } catch (e) {
        console.error(`[settle] ${options.status} settlement attempt ${tryIndex + 1}/${maxRetries + 1} failed`, e);
      }
      if (tryIndex < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (tryIndex + 1)));
      }
    }
    Sentry.captureMessage('PersistService: settleAnalysis exhausted all retries', {
      level: 'error',
      contexts: {
        settle: {
          analysisId: options.analysisId,
          videoId: options.videoId,
          status: options.status,
          maxRetries,
        },
      },
    });
  }
}
