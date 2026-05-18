import { z } from 'zod';

export const AnalysisCreateSchema = z.object({
  url: z.string().url('Invalid YouTube URL'),
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
  persona: z.enum(['p1', 'p2', 'p3', 'p4', 'p5']).optional().describe('Target persona (p1=Content Creator, p2=Indie Maker, p3=Consultant, p4=Researcher, p5=Product Manager)'),
});

export const SearchSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(500, 'Query too long'),
  limit: z.number().int().min(1).max(100).default(10),
  threshold: z.number().min(0).max(1).default(0.75),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  channels: z.array(z.string()).optional(),
  minEngagement: z.enum(['low', 'medium', 'high']).optional(),
  page: z.number().int().min(1).default(1),
});

export const CheckoutSchema = z.object({
  successUrl: z.string().url('Invalid success URL'),
  cancelUrl: z.string().url('Invalid cancel URL'),
});

export const MetadataSchema = z.object({
  videoId: z.string().min(1, 'Video ID required'),
});

export type AnalysisCreateInput = z.infer<typeof AnalysisCreateSchema>;
export type SearchInput = z.infer<typeof SearchSchema>;
export type CheckoutInput = z.infer<typeof CheckoutSchema>;
export type MetadataInput = z.infer<typeof MetadataSchema>;
