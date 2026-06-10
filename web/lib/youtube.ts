import { z } from 'zod';

const youtubeUrlSchema = z
  .string()
  .url('Must be a valid URL')
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        // Extract ID via common patterns; hostname check is too restrictive
        return !!extractIdFromUrl(parsed);
      } catch {
        return false;
      }
    },
    { message: 'Invalid YouTube URL structure' }
  )
  .transform((url) => {
    return extractIdFromUrl(new URL(url)) ?? '';
  })
  .refine((id) => /^[a-zA-Z0-9_-]{11}$/.test(id), {
    message: 'Canonical video ID verification failed',
  });

function extractIdFromUrl(parsed: URL): string | null {
  // 1. Check for nested YouTube URL in common search engine query parameters
  const nestedUrl = parsed.searchParams.get('q') || parsed.searchParams.get('url') || parsed.searchParams.get('u');
  if (nestedUrl) {
    try {
      return extractIdFromUrl(new URL(nestedUrl));
    } catch {
      // Not a valid nested URL, proceed to check 'v' parameter
    }
  }

  // 2. Check common YouTube hostnames
  if (['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'].includes(parsed.hostname)) {
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1);
    if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] ?? null;
    if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2] ?? null;
    if (parsed.pathname.startsWith('/v/')) return parsed.pathname.split('/')[2] ?? null;
    return parsed.searchParams.get('v');
  }
  
  // 3. Fallback: Try to extract 'v' param from ANY host
  return parsed.searchParams.get('v');
}

export function extractVideoId(urlStr: string): string {
  const result = youtubeUrlSchema.safeParse(urlStr);
  return result.success ? result.data : 'unknown';
}

/**
 * Normalize any YouTube URL format to standard watch?v= format
 * Handles: shorts, youtu.be, embed, v, and standard watch?v= URLs
 * Returns normalized URL or the original if extraction fails
 */
export function normalizeYoutubeUrl(urlStr: string): string {
  const videoId = extractVideoId(urlStr);
  if (videoId === 'unknown') {
    return urlStr;
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}
