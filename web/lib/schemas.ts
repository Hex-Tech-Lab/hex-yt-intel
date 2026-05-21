import { z } from 'zod';

export const AnalysisCreateSchema = z.object({
  url: z.string()
    .url('Invalid YouTube URL')
    .transform((val) => {
      // Auto-transform YouTube shorts to standard watch format at perimeter
      const shortsRegex = /\/shorts\/([a-zA-Z0-9_-]{11})/;
      const match = val.match(shortsRegex);
      if (match && match[1]) {
        return `https://www.youtube.com/watch?v=${match[1]}`;
      }
      return val;
    }),
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
}).refine(
  (data) => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    try {
      const appOrigin = new URL(appUrl).origin;
      const successOrigin = new URL(data.successUrl).origin;
      const cancelOrigin = new URL(data.cancelUrl).origin;
      return successOrigin === appOrigin && cancelOrigin === appOrigin;
    } catch {
      return false;
    }
  },
  { message: 'URLs must be on this domain' }
);

export const MetadataSchema = z.object({
  videoId: z.string().min(1, 'Video ID required'),
});

export type AnalysisCreateInput = z.infer<typeof AnalysisCreateSchema>;
export type SearchInput = z.infer<typeof SearchSchema>;
export type CheckoutInput = z.infer<typeof CheckoutSchema>;
export type MetadataInput = z.infer<typeof MetadataSchema>;
