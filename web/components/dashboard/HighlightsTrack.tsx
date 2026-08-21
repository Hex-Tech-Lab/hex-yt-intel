'use client';

import { useCallback, useMemo } from 'react';
import { Tooltip } from '@astryxdesign/core';
import { formatTimestamp } from '@/lib/utils/entity-time-seek';

/**
 * Track height in px -- the single source of truth for the scrubber's own
 * height (h-7 = 28px), imported by HighlightsScrubber.tsx to size its
 * Play/Pause button wrapper instead of hardcoding a second "h-7" that could
 * silently drift out of sync if this track's own height ever changes
 * (/simplify altitude finding, 2026-08-21).
 */
export const TRACK_HEIGHT_PX = 28;

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
  /** Real fix (live report, 2026-08-21): highlight.end is contractually
   *  "the start of the next selected segment" (web/lib/prompts/highlights-
   *  extraction.ts), not a genuinely short highlight-worthy span -- using
   *  it directly rendered the active segment's fill/end-bracket spanning
   *  nearly the whole gap to the next highlight. Actual playback
   *  (useSegmentPlayback.ts) already ignores highlight.end and advances
   *  using this same fixed duration; the segment fill and end bracket now
   *  match what actually plays instead of the broken end timestamp. */
  segmentDurationSeconds: number;
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

  // Real functional bug (live report, 2026-08-21): Next/Prev only worked
  // once something was ALREADY playing (both disabled whenever
  // clampedActiveIndex was null) -- there was no way to start playback
  // from a specific highlight via the nav while idle. Next now starts at
  // index 0 when idle, matching the Play button's own start() semantics;
  // Prev correctly stays disabled while idle (nothing to go back to).
  const handlePrev = () => {
    if (clampedActiveIndex !== null && clampedActiveIndex > 0) onSelect(clampedActiveIndex - 1);
  };
  const handleNext = () => {
    if (clampedActiveIndex === null) onSelect(0);
    else if (clampedActiveIndex < highlights.length - 1) onSelect(clampedActiveIndex + 1);
  };

  return (
    <div className="flex items-center gap-1 bg-[var(--surface-quiet)] border border-[var(--line)]">
      {/* Real fix (live report, 2026-08-21): the earlier text-[10px]
          leading-none applied to match this bar's height against the
          speed pill shrank the '<'/'>' glyphs into near-illegibility.
          Decoupled: the button itself is a fixed h-4 box (matches the
          speed pill's rendered height), the glyph inside is a normal,
          clearly-visible text-xs -- flex centering means the glyph's own
          font-size no longer controls the button's outer height. */}
      <button
        type="button"
        disabled={clampedActiveIndex === null || clampedActiveIndex === 0}
        onClick={handlePrev}
        title="Previous highlight"
        aria-label="Previous highlight"
        className="h-4 w-4 flex items-center justify-center text-xs leading-none text-[var(--ink-secondary)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line)]/50"
      >
        <span aria-hidden="true">‹</span>
      </button>
      <span className="text-[10px] font-mono font-medium px-1 text-[var(--ink-muted)]">
        {clampedActiveIndex !== null ? `#${clampedActiveIndex + 1} of ${highlights.length}` : `${highlights.length} moments`}
      </span>
      <button
        type="button"
        disabled={clampedActiveIndex !== null && clampedActiveIndex >= highlights.length - 1}
        onClick={handleNext}
        title="Next highlight"
        aria-label="Next highlight"
        className="h-4 w-4 flex items-center justify-center text-xs leading-none text-[var(--ink-secondary)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line)]/50"
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

export function HighlightsTrack({ highlights, activeIndex, onSelect, videoDurationSeconds, segmentDurationSeconds, hideNav = false }: HighlightsTrackProps) {
  // Real fix (/simplify + code-review pass, 2026-08-21): the empty-array
  // early return used to run BEFORE the hooks added below (markerLeftPcts/
  // labelVisibility useMemo) -- a Rules-of-Hooks violation, since hooks
  // must run unconditionally on every render. Moved past all hooks;
  // `maxTime`'s own `|| 1` fallback already made it safe to compute
  // against an empty highlights array.
  const maxTime =
    videoDurationSeconds && videoDurationSeconds > 0
      ? videoDurationSeconds
      : Math.max(...highlights.map((highlight) => highlight.end)) || 1;

  const clampedActiveIndex = activeIndex !== null ? Math.min(Math.max(activeIndex, 0), highlights.length - 1) : null;
  const activeHighlight = clampedActiveIndex !== null ? highlights[clampedActiveIndex] : null;
  const showPermanentLabels = highlights.length <= PERMANENT_LABEL_MAX_COUNT;

  // Shared percentage-position math (/simplify reuse finding, 2026-08-21):
  // was independently re-derived at 4 call sites (segment fill, markers,
  // end bracket, labels) with slightly different clamp bounds each time --
  // one helper, clamp bounds passed explicitly so each site's real
  // requirement (98 for markers/labels to keep them inside the track's
  // padding, 100/99 for the segment fill/end-bracket edges) stays visible.
  // Real fix (/code-review finding, 2026-08-21): the hardcoded floor of 1
  // was written for markers/labels that need a little padding so they
  // don't render flush against the track's edge -- applying that same
  // floor to the segment-fill/end-bracket edges made a highlight starting
  // at t=0 render 1% offset instead of exactly 0%, a small positional
  // regression from the pre-refactor behavior. clampMin now defaults to
  // the marker-safe 1 but callers needing an exact edge (segment fill)
  // pass 0 explicitly.
  const pctFor = useCallback(
    (time: number, clampMax = 98, clampMin = 1) => Math.min(clampMax, Math.max(clampMin, (time / maxTime) * 100)),
    [maxTime]
  );

  // Marker positions + which permanent labels survive collision detection
  // -- memoized (/simplify efficiency finding, 2026-08-21): both were
  // recomputed on every render including the ~250ms playback-position poll
  // tick, even though neither depends on that tick (only `isActive`, read
  // separately in the render below, needs to be render-fresh).
  //
  // Real fix (live report, 2026-08-21): permanent labels for two markers
  // close together visually collided/overlapped ("0:551:17"). Collision
  // check walks left-to-right comparing each marker's leftPct against the
  // last one actually SHOWN (not the immediately preceding one, so a
  // skipped label doesn't let the next one crowd in right after it) --
  // below MIN_LABEL_GAP_PCT, the label loses UNLESS it's the last
  // highlight in the whole list, which always shows per explicit
  // direction ("the one on the right should lose unless it's the last
  // one"). Hover tooltip (title + time range) stays available on every
  // marker regardless of whether its permanent label is shown.
  //
  // MIN_LABEL_GAP_PCT is a percentage of the track's rendered width, not a
  // pixel gap -- on a much narrower or wider track than this component has
  // been tested against, the same 6% could be too permissive or too
  // strict. Known limitation (docs/TECH_DEBT_LEDGER.md), not fixed here --
  // a pixel-accurate version needs a ref + measured width, out of scope
  // for tonight's pass.
  const MIN_LABEL_GAP_PCT = 6;
  const markerLeftPcts = useMemo(
    () => highlights.map((highlight) => pctFor(highlight.start)),
    [highlights, pctFor]
  );
  const labelVisibility = useMemo(() => {
    if (!showPermanentLabels) return [];
    const visible: boolean[] = [];
    let lastShownLeftPct: number | null = null;
    highlights.forEach((_highlight, idx) => {
      const leftPct = markerLeftPcts[idx]!;
      const isLast = idx === highlights.length - 1;
      const collides = lastShownLeftPct !== null && leftPct - lastShownLeftPct < MIN_LABEL_GAP_PCT;
      const show = isLast || !collides;
      visible.push(show);
      if (show) lastShownLeftPct = leftPct;
    });
    return visible;
  }, [highlights, markerLeftPcts, showPermanentLabels]);

  if (highlights.length === 0) return null;

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
            const segLeftPct = pctFor(activeHighlight.start, 100, 0);
            // Real fix (live report, 2026-08-21): activeHighlight.end is
            // contractually "the start of the next selected segment," not
            // a genuinely short highlight-worthy span -- using it directly
            // rendered this fill spanning nearly the whole gap to the next
            // highlight (the reported "94% of video duration" symptom).
            // segmentDurationSeconds (the same fixed duration
            // useSegmentPlayback.ts actually advances by) now drives the
            // fill width instead, matching what actually plays.
            const segWidthPct = Math.max(
              1,
              Math.min(100 - segLeftPct, (segmentDurationSeconds / maxTime) * 100)
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
            const leftPct = markerLeftPcts[idx]!;
            const isActive = idx === clampedActiveIndex;
            return (
              <Tooltip
                key={highlight.idx}
                content={`${highlight.label} (${formatTimestamp(highlight.start)}–${formatTimestamp(highlight.start + segmentDurationSeconds)})`}
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
              style={{ left: `${pctFor(activeHighlight.start + segmentDurationSeconds, 99)}%` }}
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
          {highlights.map((highlight, idx) => {
            if (!labelVisibility[idx]) return null;
            const leftPct = markerLeftPcts[idx]!;
            return (
              <span
                key={highlight.idx}
                className="absolute -translate-x-1/2 text-[9px] font-mono text-[var(--ink-muted)] whitespace-nowrap"
                style={{ left: `${leftPct}%` }}
              >
                {formatTimestamp(highlight.start)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
