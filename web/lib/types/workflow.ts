import { z } from 'zod';

export const WorkflowScopeSchema = z.enum(['single_video', 'cross_analysis', 'persist']);
export type WorkflowScope = z.infer<typeof WorkflowScopeSchema>;

export const PathAInputSchema = z.object({
  url: z.string().url().refine((v) => ['youtube.com', 'www.youtube.com', 'youtu.be'].includes(new URL(v).hostname), {
    message: 'Must be a valid YouTube URL',
  }).optional(),
  userId: z.string().min(1),
  tier: z.enum(['free', 'pro', 'enterprise']),
  email: z.string().email().optional(),
  timezone: z.string(),
  persona: z.enum(['p1', 'p2', 'p3', 'p4', 'p5']).optional(),
  forceRefresh: z.boolean().optional(),
});
export type PathAInput = z.infer<typeof PathAInputSchema>;

export const PathAOutputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cache_hit'), data: z.any() }),
  z.object({
    type: z.literal('processing'),
    data: z.object({
      id: z.string(),
      analysisId: z.string(),
      videoId: z.string(),
      status: z.literal('processing'),
      title: z.string(),
      metadata: z.any(),
      transcript: z.string(),
      timezone: z.string(),
      models: z.array(z.string()),
      stream: z.object({ url: z.string(), sig: z.string(), exp: z.number() }),
    }),
  }),
  z.object({ type: z.literal('error'), code: z.string(), status: z.number(), message: z.string() }),
]);
export type PathAOutput = z.infer<typeof PathAOutputSchema>;

export const PathBInputSchema = z.object({
  userId: z.string().min(1),
  query: z.string().optional(),
  models: z.array(z.string()).optional(),
});
export type PathBInput = z.infer<typeof PathBInputSchema>;

export const PathBOutputSchema = z.object({
  scope: z.literal('global'),
  knowledgeBase: z.array(z.object({
    analysisId: z.string(),
    title: z.string(),
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
  })),
});
export type PathBOutput = z.infer<typeof PathBOutputSchema>;