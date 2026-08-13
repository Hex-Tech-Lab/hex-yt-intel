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
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`;
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
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const setSeekTo = useVideoStore((s) => s.setSeekTo);
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

    // Ignore-flag guard: if analysisId changes again while this fetch is in
    // flight, an older response resolving after a newer request started must
    // not clobber `data` with the wrong analysis's highlights.
    let ignore = false;
    setData(null);
    setError(null);
    fetch(`/api/analyses/highlights?analysisId=${analysisId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
        return res.json();
      })
      .then((json: HighlightsResponse) => {
        if (!ignore) setData(json);
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      ignore = true;
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
  if (!data) return <Spinner size="sm" />;
  if (data.highlights.length === 0) return null;

  const totalHighlightsSeconds = data.highlights.length * data.segmentDurationSeconds;
  const compressionPct = videoDurationSeconds && videoDurationSeconds > 0
    ? Math.round((totalHighlightsSeconds / videoDurationSeconds) * 100)
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
