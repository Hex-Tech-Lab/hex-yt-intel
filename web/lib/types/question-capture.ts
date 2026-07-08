/**
 * Question Capture domain types — for storing user questions for wiki aggregation.
 * Questions are timestamped and stored per-user for historical record and knowledge loop.
 */

import { z } from 'zod';

export interface QuestionCaptureRequest {
  conversationId: string;
  userId: string;
  question: string;
  analysisId?: string;
  timestamp?: string; // ISO 8601 timestamp
}

export interface QuestionCaptureResponse {
  success: boolean;
  questionId: string;
  stored_at: string; // ISO timestamp
}

/**
 * Zod schemas for request/response validation
 */
export const QuestionCaptureRequestSchema = z.object({
  conversationId: z.string().min(1, 'conversationId is required'),
  userId: z.string().min(1, 'userId is required'),
  question: z.string().min(1, 'question is required').max(5000, 'question must be <= 5000 chars'),
  analysisId: z.string().optional(),
  timestamp: z.string().datetime().optional(),
});

export const QuestionCaptureResponseSchema = z.object({
  success: z.boolean(),
  questionId: z.string(),
  stored_at: z.string().datetime(),
});

export type QuestionCaptureRequestInput = z.infer<typeof QuestionCaptureRequestSchema>;
export type QuestionCaptureResponseOutput = z.infer<typeof QuestionCaptureResponseSchema>;

/**
 * Internal metadata for question storage (stored in Supabase Storage)
 */
export interface QuestionStorageMetadata {
  conversationId: string;
  userId: string;
  analysisId?: string;
  timestamp: string; // ISO 8601
  question: string;
}
