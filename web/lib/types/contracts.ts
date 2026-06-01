import { z } from 'zod';

// ─── Video Validation ───────────────────────────────────────────────────────
export const VideoIdSchema = z.string().regex(
  /^[a-zA-Z0-9_-]{11}$/,
  'Invalid video ID format'
);

// ─── Analysis ────────────────────────────────────────────────────────────────
export const AnalysisCreateSchema = z.object({
  url: z.string()
    .transform((val) => {
      // Normalize URLs: add https:// if missing, handle all YouTube formats
      let normalized = val.trim();
      if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
        normalized = `https://${normalized}`;
      }
      return normalized;
    })
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return ['youtube.com', 'www.youtube.com', 'youtu.be'].includes(parsed.hostname);
        } catch {
          return false;
        }
      },
      'Invalid YouTube URL'
    )
    .transform((val) => {
      // Auto-transform YouTube shorts/live/embed to standard watch format at perimeter
      try {
        const parsed = new URL(val);
        let videoId = '';

        if (parsed.pathname.startsWith('/shorts/')) {
          videoId = parsed.pathname.split('/')[2] ?? '';
        } else if (parsed.pathname.startsWith('/live/')) {
          videoId = parsed.pathname.split('/')[2] ?? '';
        } else if (parsed.pathname.startsWith('/embed/')) {
          videoId = parsed.pathname.split('/')[2] ?? '';
        } else if (parsed.pathname.startsWith('/v/')) {
          videoId = parsed.pathname.split('/')[2] ?? '';
        } else if (parsed.hostname === 'youtu.be') {
          videoId = parsed.pathname.slice(1);
        } else {
          videoId = parsed.searchParams.get('v') ?? '';
        }

        if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
        return val;
      } catch {
        return val;
      }
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
  forceRefresh: z.boolean().optional().default(false).describe('Force cache bypass and generate fresh analysis'),
});

// ─── Checkout ────────────────────────────────────────────────────────────────
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

// ─── Inferred Types ──────────────────────────────────────────────────────────
export type AnalysisCreateInput = z.infer<typeof AnalysisCreateSchema>;
export type CheckoutInput = z.infer<typeof CheckoutSchema>;
