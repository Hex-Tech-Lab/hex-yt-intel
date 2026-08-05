import { useEffect, useRef } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useChaptersStore, type ChapterEntry } from '@/store/useChaptersStore';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

const IDLE_ENTRY = { status: 'idle' as const, chapters: [] as ChapterEntry[], fetchedAt: null };

/**
 * Chapter markers for a given video. Thin selector over the Zustand
 * useChaptersStore (keyed by videoId). Fetches as soon as videoId is known
 * — independent of analysis status — with exponential backoff on empty/
 * failed results (chapters-decoupling design, 2026-08-06).
 *
 * Cache invalidation: re-fetch after re-analysis persists (the re-parse +
 * idempotent RPC write IS the invalidation mechanism), not description-
 * diffing. The per-video cache survives across analyses of the same video.
 *
 * Self-cancellation fix (Cubic review, 2026-08-06): the original version
 * subscribed to the WHOLE store object (`useChaptersStore()`, no selector)
 * and put it in the effect's own dependency array. Since Zustand's `set`
 * produces a new top-level state object on every call, the effect's own
 * `setLoading()` call changed that dependency and immediately re-ran the
 * effect -- whose cleanup cancelled the fetch that had just started, and
 * whose second pass short-circuited on `status === 'loading'` and did
 * nothing. The fetch's eventual result was silently discarded by its own
 * `cancelled` flag; nothing was ever stuck in "loading" forever, on
 * essentially every mount. Separately, `'error'` status wasn't in the
 * early-return guard, so after exhausting retries the effect would re-run
 * (triggered by its own setError() call) and restart the whole cycle
 * indefinitely. Fixed by decoupling "has this hook instance already
 * started a fetch for this videoId" from the reactive store subscription
 * entirely -- a plain ref, not a dependency-array value, so the effect
 * only re-runs when `videoId` itself changes.
 */
export function useChapters(videoId: string | null) {
  const entry = useChaptersStore((state) => (videoId ? state.entries[videoId] : undefined)) ?? IDLE_ENTRY;
  const setLoading = useChaptersStore((state) => state.setLoading);
  const setLoaded = useChaptersStore((state) => state.setLoaded);
  const setError = useChaptersStore((state) => state.setError);
  // Guards this hook instance from re-triggering for a videoId it has
  // already handled -- intentionally NOT derived from the store's
  // reactive `status`, which is what caused the self-cancellation bug.
  const handledForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!videoId) return;
    if (handledForRef.current === videoId) return;

    // Cross-component dedup: if another mounted consumer already has this
    // videoId loaded or in flight, don't start a second fetch -- read via
    // getState() (a snapshot, not a subscription) so this check itself
    // can't become a reactive dependency.
    const existing = useChaptersStore.getState().entries[videoId];
    if (existing && (existing.status === 'loaded' || existing.status === 'loading')) {
      handledForRef.current = videoId;
      return;
    }

    handledForRef.current = videoId;
    setLoading(videoId);

    let cancelled = false;
    let retryCount = 0;
    const fetchWithBackoff = async () => {
      while (retryCount < MAX_RETRIES && !cancelled) {
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
                setLoaded(videoId, data.chapters ?? []);
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
        retryCount++;
        if (retryCount < MAX_RETRIES && !cancelled) {
          const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount - 1), MAX_DELAY_MS);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      if (!cancelled) setError(videoId);
    };

    fetchWithBackoff();

    return () => { cancelled = true; };
  }, [videoId, setLoading, setLoaded, setError]);

  return { chapters: entry.chapters, status: entry.status };
}
