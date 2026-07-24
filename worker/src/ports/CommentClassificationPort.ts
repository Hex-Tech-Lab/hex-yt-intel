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

export interface ClassifiedComment {
  comment: VideoComment;
  label: string;
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
