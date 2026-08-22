import type { ExecutiveDigest } from '@/lib/prompts/executive-digest';

/** One entry in the completion cascade: a model id plus optional provider routing. */
export interface CompletionModel {
  model: string;
  providerOrder?: readonly string[];
}

/**
 * A single non-streaming text completion. The digest pass (the "#12 call") is a
 * short, cheap synthesis over already-condensed material — not a stream — so it
 * has its own minimal port rather than reusing the chat/analysis streaming path.
 */
export interface TextCompletionPort {
  complete(params: {
    system: string;
    user: string;
    /** Cascade entries, tried in order until one returns text; each carries its own provider routing. */
    models: readonly CompletionModel[];
    maxTokens?: number;
    analysisId?: string;
    /**
     * The requesting account's id, forwarded to OpenRouter's `user` field for
     * per-account cost/activity correlation in OpenRouter's own dashboard --
     * distinct from `user` above (that's the chat message content, an
     * unfortunate but pre-existing name collision with OpenRouter's own
     * request field naming).
     */
    requestingUserId?: string;
  }): Promise<{ text: string; model: string }>;
}

/**
 * The persistence slice the digest use case needs: an owner-scoped read of the
 * analysis (markdown + any existing digest) and a write of the generated digest.
 * A structural subset of AnalysisPersistencePort so the use case stays testable.
 */
export interface DigestPersistencePort {
  verifyOwnership(params: {
    analysisId: string;
    userId: string;
    select: string;
  }): Promise<{
    analysis_markdown?: string | null;
    analysis_payload?: unknown;
    executive_digest?: unknown;
    validation_report?: unknown;
    video_id?: string;
  } | null>;

  saveExecutiveDigest(params: {
    analysisId: string;
    userId: string;
    digest: unknown;
  }): Promise<boolean>;

  /** Real segment timing for the source video, if still within the 72h
   *  retention window (ADR 012). Null once purged -- highlights can only
   *  ever be generated while this is available. */
  getTranscriptSegments(videoId: string): Promise<Array<{ start: number; text: string }> | null>;

  /** Idempotent: safe to call even if highlights already exist for this
    *  analysis (e.g. a digest re-gen) -- replaces the prior set. */
  saveHighlights(params: {
    analysisId: string;
    highlights: Array<{ idx: number; start: number; end: number; label: string; takeawayIdx?: number | null; verbatimExcerpt?: string }>;
  }): Promise<boolean>;

  /** Save the reconciliation result as a targeted jsonb field update on
   *  the existing executive_digest row (NOT a full saveExecutiveDigest —
   *  avoids clobbering other digest fields written concurrently). */
  saveReconciliation(params: {
    analysisId: string;
    reconciliation: unknown;
  }): Promise<boolean>;
}

/** A single takeaway's grounding verdict from the reconciliation pass. */
export interface ReconciledTakeaway {
  idx: number;
  grounded: boolean;
  backingHighlightIdx: number | null;
}

/** The full reconciliation result — stored in executive_digest.reconciliation
 *  (jsonb, no new column needed). */
export interface ReconciliationResult {
  takeaways: ReconciledTakeaway[];
}

/** What we persist in the `executive_digest` jsonb column. */
export interface StoredExecutiveDigest extends ExecutiveDigest {
  /** Model id that produced the digest (for observability / cost attribution). */
  model: string;
  /** ISO 8601 generation timestamp. */
  generatedAt: string;
  /** Reconciliation result from the post-extraction LLM pass (2026-08-21,
   *  §2.B.6). null/undefined when the reconciliation call failed or hasn't
   *  been run yet — display logic treats null as "all takeaways grounded". */
  reconciliation?: ReconciliationResult | null;
}
