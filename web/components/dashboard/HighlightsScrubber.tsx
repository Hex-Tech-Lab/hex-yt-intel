'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, Spinner } from '@astryxdesign/core';
import { useVideoStore } from '@/store/useVideoStore';

interface Highlight {
  idx: number;
  start: number;
  end: number;
  label: string;
}

interface HighlightsResponse {
  highlights: Highlight[];
  segmentDurationSeconds: number;
  contextLeadSeconds: number;
}

function fmtDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m${remainderSeconds.toString().padStart(2, '0')}s` : `${remainderSeconds}s`;
}

/**
 * Sequential autoplay of extracted highlights -- the "watch 60 min in 4"
 * feature (docs/private/2026-08-13_1539_v2_HIGHLIGHTS_REEL_SHARE_WORKFLOW_SPEC.md).
 * Each segment starts contextLeadSeconds before its timestamp so playback
 * doesn't open mid-sentence, plays for segmentDurationSeconds, then advances.
 * Both are Settings Registry values, not hardcoded (task #7).
 */
export function HighlightsScrubber({ analysisId, videoDurationSeconds }: { analysisId: string; videoDurationSeconds: number | null }) {
  const [data, setData] = useState<HighlightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const setSeekTo = useVideoStore((state) => state.setSeekTo);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef(false);

  const stop = useCallback(() => {
    stopRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    setPlayingIdx(null);
  }, []);

  useEffect(() => stop, [stop]); // unmount cleanup

  useEffect(() => {
    // Stop any in-progress playback from the previous analysisId -- otherwise
    // switching videos mid-playback keeps auto-seeking a now-different
    // player against stale timestamps from the old video's highlights.
    stop();

    // AbortController: if analysisId changes again (or the component
    // unmounts) while this fetch is in flight, cancel the actual request --
    // not just an ignore-flag -- so an older response can never clobber
    // `data` with the wrong analysis's highlights, and the browser doesn't
    // keep a now-pointless request alive.
    const controller = new AbortController();

    async function loadHighlights() {
      setData(null);
      setError(null);
      setLoading(true);
      try {
        const res = await fetch(`/api/analyses/highlights?analysisId=${analysisId}`, { signal: controller.signal });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
        const json: HighlightsResponse = await res.json();
        setData(json);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.debug(`[HighlightsScrubber] fetch aborted for ${analysisId} (analysisId changed or unmounted)`);
          return;
        }
        console.warn(`[HighlightsScrubber] failed to load highlights for ${analysisId}:`, err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    loadHighlights();

    return () => {
      controller.abort();
    };
  }, [analysisId, stop]);

  const playFrom = useCallback(
    (index: number) => {
      if (!data || index >= data.highlights.length) {
        setPlayingIdx(null);
        return;
      }
      const highlight = data.highlights[index]!;
      const leadIn = Math.max(0, highlight.start - data.contextLeadSeconds);
      setSeekTo(leadIn);
      setPlayingIdx(index);
      timerRef.current = setTimeout(() => {
        if (!stopRef.current) playFrom(index + 1);
      }, data.segmentDurationSeconds * 1000);
    },
    [data, setSeekTo]
  );

  const start = useCallback(() => {
    stopRef.current = false;
    playFrom(0);
  }, [playFrom]);

  if (error) return null; // No highlights available (analysis predates the feature, or extraction failed) -- fail quiet, not a broken UI.
  if (loading || !data) return <Spinner size="sm" />;
  if (data.highlights.length === 0) return null;

  // Clamped display: the highlights' nominal total (count * fixed segment
  // duration) can exceed the source video for a short/dense video -- never
  // report a "reel" longer than the video it's summarizing.
  const totalHighlightsSeconds = Math.min(
    data.highlights.length * data.segmentDurationSeconds,
    videoDurationSeconds ?? Infinity
  );
  const compressionPct = videoDurationSeconds && videoDurationSeconds > 0
    ? Math.min(100, Math.round((totalHighlightsSeconds / videoDurationSeconds) * 100))
    : null;

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[var(--border-muted)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--ink-main)]">Highlights reel</span>
        <span className="text-[10px] text-[var(--ink-muted)]">
          {data.highlights.length} keypoints · {fmtDuration(totalHighlightsSeconds)}
          {videoDurationSeconds ? ` of ${fmtDuration(videoDurationSeconds)}` : ''}
          {compressionPct !== null ? ` (${compressionPct}%)` : ''}
        </span>
      </div>
      {playingIdx === null ? (
        <Button label="Play highlights" variant="primary" size="sm" onClick={start} />
      ) : (
        <div className="flex items-center gap-2">
          <Button label="Stop" variant="ghost" size="sm" onClick={stop} />
          <span className="text-xs text-[var(--ink-secondary)]">
            {playingIdx + 1} / {data.highlights.length} — {data.highlights[playingIdx]!.label}
          </span>
        </div>
      )}
    </div>
  );
}
