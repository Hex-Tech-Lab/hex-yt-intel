/**
 * CommentClassificationPort — Domain Port (Hexagonal-Lite)
 *
 * Batched cheap-tier LLM classification of sampled comments (Phase 5).
 * Deliberately NOT LLMCascadePort reused directly -- classification rides
 * CHAT_CASCADE (Groq GPT-OSS-120b first, cheap/fast), a different cascade
 * from ANALYSIS_CASCADE (Claude Haiku 4.5, Vertex/Bedrock-pinned) that
 * LLMCascadePort's implementation uses, and the request/response shape here
 * (a batch of comments in, a label per comment out) is nothing like a
 * streaming analysis completion.
 */

import type { VideoComment } from './CommentIngestionPort';

/** Fixed 4-way sentiment -- comments with type spam/off_topic should be excluded from sentiment aggregation at query time (classified, but not representative of audience reaction). */
export type CommentSentiment = 'positive' | 'negative' | 'neutral' | 'mixed';

/** Fixed actionable-feedback categories, user-confirmed 2026-07-25. 'experience' added 2026-09-30 for Jev classification (typesafe/jev-latest). */
export type CommentType = 'question' | 'praise' | 'criticism' | 'suggestion' | 'experience' | 'spam' | 'off_topic';

export interface ClassifiedComment {
  comment: VideoComment;
  sentiment: CommentSentiment;
  commentType: CommentType;
  /** Free-form, model-chosen per-video topic cluster -- deliberately unconstrained, not a fixed enum. Optional since Jev (2026-09-30): Jev returns typed choices only, no free text. */
  topic?: string;
  /** Pain-point score 0–1 (Jev noul). */
  painPoint: number;
  /** Question-asked score 0–1 (Jev noul). */
  questionAsked: number;
  /** Intensity score 0–2 (Jev score: 0 mild, 1 moderate, 2 strong). */
  intensity: number;
  /** Jev sentiment confidence 0–1. */
  sentimentConfidence: number;
  /** True when sentimentConfidence < minConfidence (comments.jev.minConfidence, default 0.5) — treat the sentiment as untrusted. */
  lowConfidence: boolean;
  /** Model id that produced this classification (observability / cost attribution). */
  modelUsed: string;
}

export interface CommentClassificationPort {
  /**
   * Classifies one batch (size driven by the registry's
   * comments.batch.classificationBatchSize, not this port's concern) of
   * sampled comments. Returns one ClassifiedComment per input comment, in
   * the same order -- callers persist these to comment_classifications.
   */
  classifyBatch(comments: VideoComment[]): Promise<ClassifiedComment[]>;
}
