/**
 * CommentInsights — web-side mirror of the worker's CommentInsights shape
 * (worker/src/services/cochran-mode-engine.ts, PR #378 Dispatch A), validated
 * with Zod at the read boundary instead of casting.
 */
import { z } from 'zod';

export const CommentInsightsSchema = z.object({
  population: z.number(),
  reportedTotal: z.number(),
  sampleSize: z.number(),
  classified: z.number(),
  failed: z.number(),
  lowConfidence: z.number(),
  marginOfError: z.number(),
  confidence: z.number(),
  marginScope: z.literal('sampled_pool'),
  sentiment: z.object({
    positive: z.number(),
    negative: z.number(),
    neutral: z.number(),
    mixed: z.number(),
  }),
  types: z.record(z.string(), z.number()),
  painPointCount: z.number(),
  questionCount: z.number(),
  costUsd: z.number(),
  model: z.string(),
  completedAt: z.string(),
});

export type CommentInsights = z.infer<typeof CommentInsightsSchema>;

/** Row shape returned by GET /api/comments/runs/[analysisId]. */
export interface CommentRunStatus {
  id: string;
  status: 'pending' | 'sampling' | 'completed' | 'failed';
  mode: 'uncapped' | 'cochran';
  sampled_count: number;
  created_at: string;
  completed_at: string | null;
}
