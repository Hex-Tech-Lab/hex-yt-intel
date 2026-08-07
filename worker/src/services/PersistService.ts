import * as Sentry from '@sentry/cloudflare';
import { reconstructMarkdown, extractJsonPayload, type UCISPayloadV2 } from './MarkdownReconstructor';
import { UCISPayloadSchema, ChunkPayloadSchema, UCISDimensionSchema } from './ZodSchemas';
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
  // ADR 021 Phase 1: dimensions BracketBuffer's finalize() best-effort
  // recovered from the trailing streamed buffer on abort/completion (NOT
  // "confirmed independently as each dimension streams in" -- see
  // analysis.ts's capturedDimensions comment, corrected 2026-08-07, for the
  // verified mechanism). Used as a merge/fallback source in
  // mergeDimensions() below.
  capturedDimensions?: Array<{ number: number; name: string; content: string }>;
}

const rawFetch = fetch;

/**
 * Merge BracketBuffer's incrementally-captured dimensions with whatever
 * the whole-text extraction (extractJsonPayload, above) produced.
 *
 * Contract: every dimension BracketBuffer confirmed during streaming MUST
 * survive to persistence, even if the whole-text parse/repair pass failed
 * entirely for this attempt (extracted null) or silently dropped dimensions
 * that were, individually, perfectly valid. Extracted dimensions win on a
 * per-number conflict, but ONLY when that specific extracted entry is
 * itself schema-valid (per UCISDimensionSchema: number, name, content, plus
 * any other required fields) -- a malformed extracted entry (null, missing
 * `name`, wrong type on `content`, etc.) must never override or count as
 * "covering" a captured dimension, since it would poison the merged payload
 * and fail Zod validation for the whole persist attempt. Captured ones fill
 * every gap a (valid) extracted entry didn't cover. No-op (returns extracted
 * unchanged) only when there are no captured dimensions to merge, or every
 * captured dimension's number is ACTUALLY covered by a validated extracted
 * entry -- not merely when the two arrays happen to be the same length
 * (Cubic PR #216 finding: length-equality is not a valid stand-in for
 * per-number coverage -- e.g. captured=[dim1], extracted=[null] has equal
 * length but zero real coverage and would previously have silently returned
 * the invalid `extracted` array as-is).
 */
function mergeDimensions(
  extracted: Partial<UCISPayloadV2> | null,
  captured: Array<{ number: number; name: string; content: string }> | undefined,
): Partial<UCISPayloadV2> | null {
  if (!captured || captured.length === 0) return extracted;

  const extractedDims = Array.isArray(extracted?.dimensions) ? extracted!.dimensions : [];
  const byNumber = new Map<number, { number: number; name: string; content: string }>();
  for (const dim of captured) byNumber.set(dim.number, dim);

  let anyExtractedEntryWasInvalid = false;
  // Track which dimension numbers passed validation here so the coverage
  // check below can reuse this result instead of re-parsing every extracted
  // entry a second time (was O(captured.length * extractedDims.length) Zod
  // parses; a Set lookup is O(1) per captured dimension instead).
  const validExtractedNumbers = new Set<number>();
  for (const dim of extractedDims) {
    const parsed = UCISDimensionSchema.safeParse(dim);
    if (parsed.success) {
      byNumber.set(parsed.data.number, parsed.data);
      validExtractedNumbers.add(parsed.data.number);
    } else {
      anyExtractedEntryWasInvalid = true;
    }
  }

  const mergedDims = [...byNumber.values()].sort((dimLeft, dimRight) => dimLeft.number - dimRight.number);

  const everyCapturedCoveredByValidExtracted =
    !anyExtractedEntryWasInvalid &&
    captured.every((capturedDim) => validExtractedNumbers.has(capturedDim.number));
  if (everyCapturedCoveredByValidExtracted && extracted) return extracted;

  return { ...(extracted ?? {}), schemaVersion: '2.0', dimensions: mergedDims };
}

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
    // ADR 021 Phase 1: merge in BracketBuffer's incrementally-captured
    // dimensions before schema validation, so a captured-only fallback (the
    // whole-text extract failed/dropped dimensions entirely) is validated
    // and persisted the same way a normal extraction would be, not silently
    // skipped. See mergeDimensions()'s doc comment for the merge contract.
    const merged = mergeDimensions(extracted, options.capturedDimensions);

    const isChunk = options.chunkIndex !== undefined;
    // UCISPayloadSchema (the non-chunked/full-persistence schema) requires
    // top-level fields a dimensions-only captured fallback can never supply
    // (persona, classification -- both required, not optional). Those can
    // only come from a successful whole-text `extracted` parse. So when
    // chunkIndex is omitted AND whole-text extraction produced nothing,
    // mergeDimensions()'s captured-only result is guaranteed to fail
    // UCISPayloadSchema -- that's an EXPECTED degraded-fallback outcome
    // (markdown-only persistence, below), not a real validation error.
    // Before this guard, that guaranteed-fail attempt still ran and logged
    // an 'error'-severity Sentry event every time, spamming Sentry with
    // what Cubic's PR #216 review correctly identified as non-error noise
    // (see docs/agent-prompts/2026-08-07-self-pr216-cubic-fixes.md P1/P2).
    // No call site in this codebase currently omits chunkIndex (see
    // web/hooks/useSSEStream.ts:300 -- every persist request is chunked),
    // so this is a defensive/dead-in-practice path today; kept correct
    // rather than deleted since PersistOptions still types chunkIndex as
    // optional and nothing enforces it's always sent.
    const nonChunkedCapturedOnlyFallback = !isChunk && !extracted && merged;
    if (nonChunkedCapturedOnlyFallback) {
      console.warn(
        '[persist] Non-chunked persist with no whole-text extraction: captured-only fallback cannot satisfy the full UCISPayloadSchema (missing persona/classification) -- skipping structured payload, markdown-only fallback applies.',
        {
          analysisId: options.analysisId,
          videoId: options.videoId,
          capturedDimensionCount: options.capturedDimensions?.length ?? 0,
        },
      );
    } else if (merged) {
      const schema = selectPersistSchema(isChunk);
      if (!schema) return false;

      // mergeDimensions() always stamps schemaVersion:'2.0' on every return
      // path (the pass-through `extracted` branch already carries it --
      // extractJsonPayload only returns non-null when schemaVersion==='2.0'
      // -- and the constructed-merge branch sets it explicitly), so `merged`
      // is never missing it here. No conditional stamping needed.
      const result = schema.safeParse(merged);
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
              capturedDimensionCount: options.capturedDimensions?.length ?? 0,
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
