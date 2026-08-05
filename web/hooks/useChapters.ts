import { useEffect, useRef } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useChaptersStore } from '@/store/useChaptersStore';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

/**
 * Chapter markers for a given video. Thin selector over the Zustand
 * useChaptersStore (keyed by videoId). Fetches as soon as videoId is known
 * — independent of analysis status — with exponential backoff on empty/
 * failed results (chapters-decoupling design, 2026-08-06).
 *
 * Cache invalidation: re-fetch after re-analysis persists (the re-parse +
 * idempotent RPC write IS the invalidation mechanism), not description-
 * diffing. The per-video cache survives across analyses of the same video.
 */
export function useChapters(videoId: string | null) {
  const store = useChaptersStore();
  const entry = videoId ? store.getChapters(videoId) : { status: 'idle' as const, chapters: [], fetchedAt: null };
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!videoId) return;
    if (entry.status === 'loaded' || entry.status === 'loading') return;

    store.setLoading(videoId);
    retryCountRef.current = 0;

    let cancelled = false;
    const fetchWithBackoff = async () => {
      while (retryCountRef.current < MAX_RETRIES && !cancelled) {
        let confirmedLoaded = false;
        try {
          const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/chapters`);
          if (cancelled) return;
          if (res.ok) {
            const data = await res.json() as { chapters?: Array<{ idx: number; start_seconds: number; end_seconds: number; label: string }>; confirmed?: boolean };
            if (!cancelled) {
              // confirmed: false means no sentinel/real rows exist yet -- the
              // worker's fire-and-forget write can still be in flight (fires
              // from inside the SSE stream handler). Treat as not-yet-final
              // and keep retrying, same as a network failure, rather than
              // caching a false "no chapters" the moment the first request
              // happens to race ahead of the write.
              if (data.confirmed) {
                store.setLoaded(videoId, data.chapters ?? []);
                confirmedLoaded = true;
              }
            }
          }
        } catch (err) {
          if (!cancelled) {
            Sentry.captureException(err, { contexts: { chapters: { videoId } } });
          }
        } finally {
          if (confirmedLoaded) return;
        }
        retryCountRef.current++;
        if (retryCountRef.current < MAX_RETRIES && !cancelled) {
          const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCountRef.current - 1), MAX_DELAY_MS);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      if (!cancelled) store.setError(videoId);
    };

    fetchWithBackoff();

    return () => { cancelled = true; };
  }, [videoId, entry.status, store]);

  return { chapters: entry.chapters, status: entry.status };
}
