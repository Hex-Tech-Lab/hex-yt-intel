'use client';

import { Tooltip } from '@astryxdesign/core';

/** MM:SS formatter local to this file -- deliberately not imported from
 *  entity-time-seek.ts's formatTimestamp, per this component's own
 *  no-coupling-to-that-file rule (see file doc comment below). */
function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const remainderSeconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${remainderSeconds.toString().padStart(2, '0')}`;
}

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
        className="p-0.5 text-[var(--ink-secondary)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line)]/50"
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
        className="p-0.5 text-[var(--ink-secondary)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line)]/50"
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

// Real density constraint (live report, 2026-08-21): highlight count is
// uncapped up to highlights.maxCount (currently 40). Permanent per-marker
// timestamp labels are only legible when there are few enough markers that
// they don't visually collide -- above this count, hover (the Tooltip
// already on every marker) stays the only way to see a timestamp. User's
// own number, not a guess.
const PERMANENT_LABEL_MAX_COUNT = 15;

export function HighlightsTrack({ highlights, activeIndex, onSelect, videoDurationSeconds, hideNav = false }: HighlightsTrackProps) {
  if (highlights.length === 0) return null;

  const maxTime =
    videoDurationSeconds && videoDurationSeconds > 0
      ? videoDurationSeconds
      : Math.max(...highlights.map((highlight) => highlight.end)) || 1;

  const clampedActiveIndex = activeIndex !== null ? Math.min(Math.max(activeIndex, 0), highlights.length - 1) : null;
  const activeHighlight = clampedActiveIndex !== null ? highlights[clampedActiveIndex] : null;
  const showPermanentLabels = highlights.length <= PERMANENT_LABEL_MAX_COUNT;

  return (
    <div className="flex flex-col gap-1.5">
      {!hideNav && (
        <div className="flex items-center justify-between gap-2">
          <HighlightsNav highlights={highlights} activeIndex={activeIndex} onSelect={onSelect} />
        </div>
      )}

      {/* Scrubber track container -- fixed height regardless of label mode;
          permanent labels render in a separate sibling row below (next
          block) rather than growing this container, so they don't fight
          the markers' own top-1/2 vertical-centering math. */}
      <div className="relative w-full h-7 flex items-center bg-[var(--surface-quiet)] border border-[var(--line-faint)] px-2">
        <div className="absolute left-2 right-2 h-1 bg-[var(--line-faint)]">
          {activeHighlight && (() => {
            const segLeftPct = Math.min(100, (activeHighlight.start / maxTime) * 100);
            const segWidthPct = Math.max(
              1,
              Math.min(100 - segLeftPct, ((activeHighlight.end - activeHighlight.start) / maxTime) * 100)
            );
            return (
              // Real fix (live report, 2026-08-20): the active-segment fill
              // was accent-a15 (15% opacity) on a 4px-tall bar -- too faint
              // to read as a segment at all ("the segment is missing").
              // Stronger fill + a real top/bottom border, taller than the
              // base line so it visually reads as its own band, not just
              // more line. Stays in the single-accent cyan family
              // (web/app/globals.css has no secondary/warning/success
              // palette anywhere in this app -- introducing a new hue here
              // would be the first departure from that system, not a
              // deliberate second color) -- intensity, not hue, was the gap.
              <div
                className="absolute top-1/2 -translate-y-1/2 h-3 bg-[var(--accent-a30)] border-y border-[var(--accent-a70)]"
                style={{ left: `${segLeftPct}%`, width: `${segWidthPct}%` }}
              />
            );
          })()}
        </div>

        <div className="absolute left-2 right-2 inset-y-0 pointer-events-none">
          {highlights.map((highlight, idx) => {
            const leftPct = Math.min(98, Math.max(1, (highlight.start / maxTime) * 100));
            const isActive = idx === clampedActiveIndex;
            return (
              <Tooltip
                key={highlight.idx}
                content={`${highlight.label} (${formatClock(highlight.start)}–${formatClock(highlight.end)})`}
                placement="above"
              >
                {/* Real accessibility fix (automated review on PR #266): the
                    marker's visual square (2-4px wide) was previously ALSO
                    the interactive hit area -- nearly unclickable,
                    especially on touch. The button now keeps a proper
                    minimum hit target (24x24px min, WCAG 2.5.5-adjacent
                    guidance) while an inner span carries the actual mark:
                    a rounded start dot for the active highlight (its own
                    segment-start anchor), a thin bar otherwise. */}
                <button
                  type="button"
                  onClick={() => onSelect(idx)}
                  style={{ left: `${leftPct}%` }}
                  aria-label={`Jump to highlight ${idx + 1}: ${highlight.label}`}
                  className="group absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-auto flex items-center justify-center w-6 h-7 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1"
                >
                  <span
                    aria-hidden="true"
                    className={`block transition-transform group-hover:scale-125 ${
                      isActive
                        ? 'w-2 h-2 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent-glow)] z-10'
                        : 'w-0.5 h-3 bg-[var(--ink-muted)] group-hover:bg-[var(--accent)]'
                    }`}
                  />
                </button>
              </Tooltip>
            );
          })}

          {/* End bracket: visual-only closure mark at the active segment's
              end -- deliberately not a button. Clicking anywhere in the
              segment body (or the end point specifically) to seek to an
              arbitrary mid-segment time would need real new playback
              plumbing (useSegmentPlayback only supports jumping to a
              highlight's start today) -- out of scope for this visual
              pass, per explicit user direction. */}
          {activeHighlight && (
            <span
              aria-hidden="true"
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-3.5 border-r-2 border-t-2 border-b-2 border-[var(--accent-a70)] z-10"
              style={{ left: `${Math.min(99, Math.max(1, (activeHighlight.end / maxTime) * 100))}%` }}
            />
          )}
        </div>
      </div>

      {/* Permanent per-marker timestamp row, only when the highlight count
          is low enough to stay legible (user-specified threshold). Above
          that count, the Tooltip on each marker (hover) remains the only
          way to see a timestamp -- deliberately not shown here to avoid
          label collision at high density. */}
      {showPermanentLabels && (
        <div className="relative w-full h-3 px-2" aria-hidden="true">
          {highlights.map((highlight) => {
            const leftPct = Math.min(98, Math.max(1, (highlight.start / maxTime) * 100));
            return (
              <span
                key={highlight.idx}
                className="absolute -translate-x-1/2 text-[9px] font-mono text-[var(--ink-muted)] whitespace-nowrap"
                style={{ left: `${leftPct}%` }}
              >
                {formatClock(highlight.start)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
