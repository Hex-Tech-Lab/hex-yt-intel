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
 * Cache invalidation: `useSSEStream`'s `startAnalysis` calls
 * `useChaptersStore.getState().reset(videoId)` on a new/forced-refresh
 * analysis of this video, which bumps the store's per-video `generations`
 * counter. This hook watches that counter (a scoped primitive selector --
 * NOT `entry.status`, which would re-fire on every loading/loaded/error
 * transition the effect's own calls cause, reintroducing a variant of the
 * self-cancellation bug below) and restarts the fetch when it changes, so
 * a re-analysis of an already-loaded video actually refreshes.
 *
 * Cancel-before-completion fix (Cubic review, 2026-08-06): if this hook's
 * fetch loop is cancelled (unmount, or React Strict Mode's dev-only
 * mount->cleanup->remount double-invoke) before it ever calls `setLoaded`
 * or `setError`, the store entry is left stuck at `'loading'` forever --
 * nothing ever settles it, and `handledForRef` blocks a same-videoId
 * remount from retrying. Fixed by resetting the store entry back to idle
 * (which also bumps `generations`) in the cleanup when the fetch didn't
 * reach a terminal state; combined with the generation-aware guard above,
 * a Strict-Mode remount (or a real remount after an aborted navigation)
 * now correctly restarts the fetch instead of leaving a
 * permanently-loading, permanently-stuck entry.
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
  const generation = useChaptersStore((state) => (videoId ? state.generations[videoId] : undefined) ?? 0);
  const setLoading = useChaptersStore((state) => state.setLoading);
  const setLoaded = useChaptersStore((state) => state.setLoaded);
  const setError = useChaptersStore((state) => state.setError);
  // Guards this hook instance from re-triggering for a videoId+generation
  // it has already handled -- intentionally NOT derived from the store's
  // reactive `status`, which is what caused the self-cancellation bug.
  const handledForRef = useRef<{ videoId: string; generation: number } | null>(null);

  useEffect(() => {
    if (!videoId) return;
    // Already handled this exact videoId+generation -- nothing to do. A
    // reset() bumps `generation`, which is the only thing that should ever
    // make this effect actually restart a fetch.
    if (handledForRef.current?.videoId === videoId && handledForRef.current.generation === generation) return;

    // Cross-component dedup: if another mounted consumer already has this
    // videoId loaded or in flight, don't start a second fetch -- read via
    // getState() (a snapshot, not a subscription) so this check itself
    // can't become a reactive dependency.
    const existing = useChaptersStore.getState().entries[videoId];
    if (existing && (existing.status === 'loaded' || existing.status === 'loading')) {
      handledForRef.current = { videoId, generation };
      return;
    }

    handledForRef.current = { videoId, generation };
    const loadGeneration = setLoading(videoId);
    let reachedTerminal = false;

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
                setLoaded(videoId, data.chapters ?? [], loadGeneration);
                confirmedLoaded = true;
                reachedTerminal = true;
              }
            }
          }
        } catch (err) {
          if (!cancelled) {
            Sentry.captureException(err, { contexts: { chapters: { videoId } } });
          }
        } finally {
          // No return here (DeepSource flags return-in-finally as unsafe --
          // it can silently override a try block's own return) -- the loop
          // exit on success is handled by the plain check below instead.
        }
        if (confirmedLoaded) return;
        retryCount++;
        if (retryCount < MAX_RETRIES && !cancelled) {
          const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount - 1), MAX_DELAY_MS);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      if (!cancelled) {
        setError(videoId, loadGeneration);
        reachedTerminal = true;
      }
    };

    fetchWithBackoff();

    return () => {
      cancelled = true;
      // Cancelled before ever calling setLoaded/setError (unmount, or React
      // Strict Mode's dev-only mount->cleanup->remount double-invoke): the
      // store entry is stuck at 'loading' with nothing left to settle it,
      // and handledForRef would otherwise block a remount from retrying.
      // Reset back to idle so the next mount (Strict Mode's second pass, or
      // a real remount) restarts the fetch instead of staying stuck.
      if (!reachedTerminal) {
        useChaptersStore.getState().reset(videoId);
      }
    };
  }, [videoId, generation, setLoading, setLoaded, setError]);

  return { chapters: entry.chapters, status: entry.status };
}
