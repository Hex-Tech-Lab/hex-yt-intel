import { z } from 'zod';

const youtubeUrlSchema = z
  .string()
  .url('Must be a valid URL')
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return ['youtube.com', 'www.youtube.com', 'youtu.be'].includes(
          parsed.hostname
        );
      } catch {
        return false;
      }
    },
    { message: 'Invalid YouTube host domain' }
  )
  .transform((url) => {
    const parsed = new URL(url);
    let id = '';
    if (parsed.hostname === 'youtu.be') {
      id = parsed.pathname.slice(1);
    } else if (parsed.pathname.startsWith('/embed/')) {
      id = parsed.pathname.split('/')[2] ?? '';
    } else if (parsed.pathname.startsWith('/v/')) {
      id = parsed.pathname.split('/')[2] ?? '';
    } else {
      id = parsed.searchParams.get('v') ?? '';
    }
    return id;
  })
  .refine((id) => /^[a-zA-Z0-9_-]{11}$/.test(id), {
    message: 'Canonical video ID verification failed',
  });

export function extractVideoId(urlStr: string): string {
  const result = youtubeUrlSchema.safeParse(urlStr);
  return result.success ? result.data : 'unknown';
}
