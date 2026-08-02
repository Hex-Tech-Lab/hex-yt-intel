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
  } | null>;

  saveExecutiveDigest(params: {
    analysisId: string;
    userId: string;
    digest: unknown;
  }): Promise<boolean>;
}

/** What we persist in the `executive_digest` jsonb column. */
export interface StoredExecutiveDigest extends ExecutiveDigest {
  /** Model id that produced the digest (for observability / cost attribution). */
  model: string;
  /** ISO 8601 generation timestamp. */
  generatedAt: string;
}
