import { useEffect, useRef, useState } from 'react';

/**
 * Chapter markers for the current analysis's video. Fetched once per analysis
 * id from `GET /api/analyses/[id]/chapters` (which reads transcript_chapters
 * rows via SupabaseTranscriptAdapter.getChapters). Gap 3 wiring
 * (2026-08-05): these are threaded into findEntityTimestamp's third argument
 * so an entity click uses a real chapter boundary when one exists.
 *
 * Mirrors useExecutiveDigest's per-analysis fetch-guard pattern: one fetch per
 * analysis id, reset when the analysis changes or re-analysis starts. Returns
 * [] while unknown and the actual array once loaded — callers should treat
 * "no chapters" and "not loaded yet" the same (findEntityTimestamp falls
 * through to regex either way).
 */
export function useChapters(analysisId: string | null, status: string) {
  const [chapters, setChapters] = useState<
    Array<{ idx: number; start_seconds: number; end_seconds: number; label: string }>
  >([]);
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
    chaptersFetchedForRef.current = analysisId;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/analyses/${analysisId}/chapters`);
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { chapters?: Array<{ idx: number; start_seconds: number; end_seconds: number; label: string }> };
          if (!cancelled) setChapters(data.chapters ?? []);
        }
      } catch (err) {
        console.debug('[chapters] fetch failed:', err);
      } finally {
        // No resource to release here (the `cancelled` flag set by this
        // effect's own cleanup handles the abandoned-request case) -- this
        // finally exists to satisfy qa-intel's WorkflowRule I/O-safety check,
        // which requires fetch calls to be wrapped in try/finally regardless
        // of whether the finally body does anything.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  return { chapters };
}
