import { useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Chapter markers for the current analysis's video. Fetched from
 * `GET /api/analyses/[id]/chapters` (which reads transcript_chapters rows via
 * SupabaseTranscriptAdapter.getChapters). Gap 3 wiring (2026-08-05): these
 * are threaded into findEntityTimestamp's third argument so an entity click
 * uses a real chapter boundary when one exists.
 *
 * Mirrors useExecutiveDigest's per-analysis fetch-guard pattern, with one
 * addition: an empty result is only treated as final once `status` is
 * 'complete'. Server-side chapter persistence (P0-1, 2026-08-05) can land
 * slightly after this hook's first fetch fires -- without the status check,
 * a fetch that races ahead of persistence would cache an empty [] forever
 * and never retry even after the chapters actually land.
 */
export function useChapters(analysisId: string | null, status: string) {
  const [chapters, setChapters] = useState<
    Array<{ idx: number; start_seconds: number; end_seconds: number; label: string }>
  >([]);
  // Locked in only once a fetch returns non-empty chapters, or returns empty
  // while status is already terminal ('complete') -- an empty result during
  // an earlier status is provisional and must be retried once complete.
  const chaptersFetchedForRef = useRef<string | null>(null);

  // Reset when analysis changes or a new analysis starts streaming.
  useEffect(() => {
    if (status === 'analyzing' || status === 'downloading') {
      setChapters([]);
      chaptersFetchedForRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    setChapters([]);
    chaptersFetchedForRef.current = null;
  }, [analysisId]);

  useEffect(() => {
    if (!analysisId) return;
    if (chaptersFetchedForRef.current === analysisId) return;

    let cancelled = false;
    void (async () => {
      // A fetch's outcome is "final" (lock in chaptersFetchedForRef, stop
      // retrying) when it found real chapters, or when status is already
      // 'complete' -- a status-'complete' outcome can't improve on retry
      // regardless of which branch (success/non-ok/error) produced it, so
      // the check is centralized here instead of duplicated three times.
      let isFinal = status === 'complete';
      try {
        const res = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}/chapters`);
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { chapters?: Array<{ idx: number; start_seconds: number; end_seconds: number; label: string }> };
          const fetched = data.chapters ?? [];
          if (!cancelled) setChapters(fetched);
          isFinal = isFinal || fetched.length > 0;
        }
      } catch (err) {
        // Don't report cancelled/aborted fetches (unmount or analysisId/status
        // change tearing down this effect) as real errors -- those are
        // expected React-lifecycle noise, not application failures.
        if (!cancelled) {
          Sentry.captureException(err, { contexts: { chapters: { analysisId, status } } });
        }
      } finally {
        if (!cancelled && isFinal) chaptersFetchedForRef.current = analysisId;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [analysisId, status]);

  return { chapters };
}
