'use client';

/**
 * Shared marker-track scrubber shell for the highlights reel (2026-08-20
 * redesign, live user report -- docs/UI_FEEDBACK_TRIAGE_2026-08-20.md items
 * 6-8). Presentational only: renders dot markers + an active-segment
 * highlight window on a horizontal track and Prev/Next nav with a "#N of M"
 * counter.
 *
 * VISUAL PATTERN ONLY, adapted from EntityMentionTimeline.tsx
 * (web/components/templates/console/EntityMentionTimeline.tsx, ADR 025) --
 * per the dispatch's CRITICAL CORRECTION, none of that component's
 * seek-target/mention-ranking logic (entity-time-seek.ts,
 * RankedEntityMention) is reused here. This component owns no seek/playback
 * state at all -- it is purely `activeIndex` in, `onSelect` out; both
 * HighlightsScrubber.tsx (authed, useVideoStore) and PublicHighlightsReel.tsx
 * (anon, YouTubePlayerAdapter) drive their own seek logic from
 * analysis_highlights timestamps and call onSelect.
 */

export interface HighlightsTrackHighlight {
  idx: number;
  start: number;
  end: number;
  label: string;
}

export interface HighlightsTrackProps {
  highlights: HighlightsTrackHighlight[];
  activeIndex: number | null;
  onSelect: (index: number) => void;
  videoDurationSeconds: number | null;
}

export function HighlightsTrack({ highlights, activeIndex, onSelect, videoDurationSeconds }: HighlightsTrackProps) {
  if (highlights.length === 0) return null;

  const maxTime =
    videoDurationSeconds && videoDurationSeconds > 0
      ? videoDurationSeconds
      : Math.max(...highlights.map((highlight) => highlight.end)) || 1;

  const clampedActiveIndex = activeIndex !== null ? Math.min(Math.max(activeIndex, 0), highlights.length - 1) : null;
  const activeHighlight = clampedActiveIndex !== null ? highlights[clampedActiveIndex] : null;

  const handlePrev = () => {
    if (clampedActiveIndex !== null && clampedActiveIndex > 0) onSelect(clampedActiveIndex - 1);
  };
  const handleNext = () => {
    if (clampedActiveIndex !== null && clampedActiveIndex < highlights.length - 1) onSelect(clampedActiveIndex + 1);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 bg-[var(--surface-quiet,#f3f4f6)] p-0.5 rounded-lg border border-[var(--line,#e5e7eb)]">
          <button
            type="button"
            disabled={clampedActiveIndex === null || clampedActiveIndex === 0}
            onClick={handlePrev}
            title="Previous highlight"
            aria-label="Previous highlight"
            className="p-1 rounded text-[var(--ink-secondary,#4b5563)] hover:text-[var(--ink,#111827)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line,#e5e7eb)]/50 transition-colors"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span className="text-[10px] font-mono font-medium px-1 text-[var(--ink-muted,#6b7280)]">
            {clampedActiveIndex !== null ? `#${clampedActiveIndex + 1} of ${highlights.length}` : `${highlights.length} moments`}
          </span>
          <button
            type="button"
            disabled={clampedActiveIndex === null || clampedActiveIndex >= highlights.length - 1}
            onClick={handleNext}
            title="Next highlight"
            aria-label="Next highlight"
            className="p-1 rounded text-[var(--ink-secondary,#4b5563)] hover:text-[var(--ink,#111827)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line,#e5e7eb)]/50 transition-colors"
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      {/* Scrubber track container */}
      <div className="relative w-full h-7 flex items-center bg-[var(--surface-quiet,#f3f4f6)] rounded-lg px-2 border border-[var(--line-faint,#eef0f3)]">
        <div className="absolute left-2 right-2 h-1.5 bg-[var(--line,#e5e7eb)] rounded-full overflow-hidden">
          {activeHighlight && (
            <div
              className="absolute top-0 bottom-0 bg-[var(--accent,#3b82f6)]/40 rounded-full"
              style={{
                left: `${Math.min(100, (activeHighlight.start / maxTime) * 100)}%`,
                width: `${Math.max(
                  1,
                  Math.min(100 - (activeHighlight.start / maxTime) * 100, ((activeHighlight.end - activeHighlight.start) / maxTime) * 100)
                )}%`,
              }}
            />
          )}
        </div>

        <div className="absolute left-2 right-2 inset-y-0 pointer-events-none">
          {highlights.map((highlight, idx) => {
            const leftPct = Math.min(98, Math.max(1, (highlight.start / maxTime) * 100));
            const isActive = idx === clampedActiveIndex;
            return (
              <button
                key={highlight.idx}
                type="button"
                onClick={() => onSelect(idx)}
                style={{ left: `${leftPct}%` }}
                title={highlight.label}
                aria-label={`Jump to highlight ${idx + 1}: ${highlight.label}`}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-auto transition-transform hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#3b82f6)] focus-visible:ring-offset-1 ${
                  isActive
                    ? 'w-3.5 h-3.5 rounded-full bg-[var(--accent,#3b82f6)] shadow-[0_0_10px_rgba(59,130,246,0.8)] border-2 border-white z-10 scale-110'
                    : 'w-2 h-2 rounded-full bg-[var(--ink-muted,#9ca3af)] hover:bg-[var(--accent,#3b82f6)]'
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
