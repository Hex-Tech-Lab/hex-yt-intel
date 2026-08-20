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
  /** Suppress the built-in Prev/Next + "#N of M" nav row -- set when a
   *  caller renders <HighlightsNav> itself elsewhere (e.g. in a shared
   *  header row alongside other stats) instead of stacked above the track. */
  hideNav?: boolean;
}

/**
 * Prev/Next + "#N of M" (or "N moments" when nothing is active) nav strip.
 * Extracted out of HighlightsTrack (2026-08-20 layout revision) so
 * HighlightsScrubber.tsx can place it in its header row instead of stacked
 * above the track, without duplicating the index-clamp/prev/next logic.
 */
export function HighlightsNav({
  highlights,
  activeIndex,
  onSelect,
}: Pick<HighlightsTrackProps, 'highlights' | 'activeIndex' | 'onSelect'>) {
  const clampedActiveIndex = activeIndex !== null ? Math.min(Math.max(activeIndex, 0), highlights.length - 1) : null;

  const handlePrev = () => {
    if (clampedActiveIndex !== null && clampedActiveIndex > 0) onSelect(clampedActiveIndex - 1);
  };
  const handleNext = () => {
    if (clampedActiveIndex !== null && clampedActiveIndex < highlights.length - 1) onSelect(clampedActiveIndex + 1);
  };

  return (
    <div className="flex items-center gap-1 bg-[var(--surface-quiet)] border border-[var(--line)]">
      <button
        type="button"
        disabled={clampedActiveIndex === null || clampedActiveIndex === 0}
        onClick={handlePrev}
        title="Previous highlight"
        aria-label="Previous highlight"
        className="p-1 text-[var(--ink-secondary)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line)]/50"
      >
        <span aria-hidden="true">‹</span>
      </button>
      <span className="text-[10px] font-mono font-medium px-1 text-[var(--ink-muted)]">
        {clampedActiveIndex !== null ? `#${clampedActiveIndex + 1} of ${highlights.length}` : `${highlights.length} moments`}
      </span>
      <button
        type="button"
        disabled={clampedActiveIndex === null || clampedActiveIndex >= highlights.length - 1}
        onClick={handleNext}
        title="Next highlight"
        aria-label="Next highlight"
        className="p-1 text-[var(--ink-secondary)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line)]/50"
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

export function HighlightsTrack({ highlights, activeIndex, onSelect, videoDurationSeconds, hideNav = false }: HighlightsTrackProps) {
  if (highlights.length === 0) return null;

  const maxTime =
    videoDurationSeconds && videoDurationSeconds > 0
      ? videoDurationSeconds
      : Math.max(...highlights.map((highlight) => highlight.end)) || 1;

  const clampedActiveIndex = activeIndex !== null ? Math.min(Math.max(activeIndex, 0), highlights.length - 1) : null;
  const activeHighlight = clampedActiveIndex !== null ? highlights[clampedActiveIndex] : null;

  return (
    <div className="flex flex-col gap-1.5">
      {!hideNav && (
        <div className="flex items-center justify-between gap-2">
          <HighlightsNav highlights={highlights} activeIndex={activeIndex} onSelect={onSelect} />
        </div>
      )}

      {/* Scrubber track container */}
      <div className="relative w-full h-7 flex items-center bg-[var(--surface-quiet)] border border-[var(--line-faint)] px-2">
        <div className="absolute left-2 right-2 h-1 bg-[var(--line-faint)]">
          {activeHighlight && (
            <div
              className="absolute top-0 bottom-0 bg-[var(--accent-a15)]"
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
              // Real accessibility fix (automated review on PR #266): the
              // marker's visual square (2-4px wide) was previously ALSO the
              // interactive hit area -- nearly unclickable, especially on
              // touch. The button now keeps a proper minimum hit target
              // (24x24px min, WCAG 2.5.5-adjacent guidance) while an inner
              // span carries the actual thin Obsidian-Escher marker mark.
              <button
                key={highlight.idx}
                type="button"
                onClick={() => onSelect(idx)}
                style={{ left: `${leftPct}%` }}
                title={highlight.label}
                aria-label={`Jump to highlight ${idx + 1}: ${highlight.label}`}
                className="group absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-auto flex items-center justify-center w-6 h-7 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1"
              >
                <span
                  aria-hidden="true"
                  className={`block transition-transform group-hover:scale-125 ${
                    isActive
                      ? 'w-1 h-4 bg-[var(--accent)] z-10'
                      : 'w-0.5 h-3 bg-[var(--ink-muted)] group-hover:bg-[var(--accent)]'
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
