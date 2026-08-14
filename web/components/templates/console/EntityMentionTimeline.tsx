'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { useVideoStore } from '@/store/useVideoStore';
import { formatTimestamp, type RankedEntityMention } from '@/lib/utils/entity-time-seek';

export interface EntityMentionTimelineProps {
  entityId: string | null;
  entityLabel: string | null;
  mentions: RankedEntityMention[];
  videoDuration: number | null;
  onClose?: () => void;
}

/**
 * Entity Mention Timeline Scrubber (ADR 025).
 * Renders an interactive timeline strip for entity mention exploration,
 * featuring significance-ranked markers, forward/back stepping, and
 * auto-segment playback bounding.
 */
export function EntityMentionTimeline({
  entityId,
  entityLabel,
  mentions,
  videoDuration,
  onClose,
}: EntityMentionTimelineProps) {
  const [activeRankIndex, setActiveRankIndex] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(true);
  // Cubic review, PR #224: a manual seek (marker click / Prev / Next) calls
  // setSeekTo, but the store's currentPlaybackSeconds doesn't reflect the
  // new position until the player actually catches up (a few polling ticks
  // later). In that window, the auto-advance effect below was still
  // evaluating the OLD (stale) currentPlaybackSeconds against the NEWLY
  // selected mention's segmentEndSeconds -- selecting an EARLIER marker
  // while playback was already past that marker's segment end immediately
  // triggered another auto-advance, bouncing the user away from their own
  // selection. Track the target of any seek we just issued and ignore
  // auto-advance evaluation until currentPlaybackSeconds actually reflects
  // having reached it.
  const [pendingSeekSeconds, setPendingSeekSeconds] = useState<number | null>(null);

  const currentPlaybackSeconds = useVideoStore((state) => state.currentPlaybackSeconds);
  const isPlaying = useVideoStore((state) => state.isPlaying);

  const issueSeek = useCallback((seconds: number) => {
    setPendingSeekSeconds(seconds);
    useVideoStore.getState().setSeekTo(seconds);
  }, []);

  // Clear the pending-seek guard once playback has genuinely caught up to
  // the requested target -- a 1s tolerance since polling ticks are coarse
  // (VideoPlayerCard polls ~4x/sec) and an exact match isn't guaranteed.
  // CodeRabbit review, 2026-08-08: the original `currentPlaybackSeconds >=
  // pendingSeekSeconds - 1` only guarded FORWARD seeks -- for a BACKWARD
  // seek (target behind the current position), that condition is already
  // true before the player has moved at all, clearing the guard
  // immediately and letting the stale pre-seek currentPlaybackSeconds
  // trigger another auto-advance right away (the same cascade class this
  // guard exists to prevent, just from the opposite direction). A
  // symmetric absolute-distance check requires playback to actually arrive
  // near the target regardless of seek direction.
  useEffect(() => {
    if (pendingSeekSeconds === null || currentPlaybackSeconds === null) return;
    if (Math.abs(currentPlaybackSeconds - pendingSeekSeconds) <= 1) {
      setPendingSeekSeconds(null);
    }
  }, [pendingSeekSeconds, currentPlaybackSeconds]);

  // Reset active index (and any leftover pending-seek guard) when the
  // selected entity changes -- CodeRabbit review, 2026-08-08: a pending
  // seek from the PREVIOUS entity's timeline could otherwise carry over
  // and suppress auto-advance evaluation for the newly-selected entity
  // until it happened to resolve on its own.
  useEffect(() => {
    setActiveRankIndex(0);
    setPendingSeekSeconds(null);
  }, [entityId]);

  // `mentions` arrives sorted by significance descending (ADR 025 contract,
  // relied on elsewhere -- not changed here). But this component renders a
  // horizontal TIME-positioned track (each dot's left offset is
  // seekSeconds/maxTime), so navigating/counting/highlighting by the
  // significance-sorted index desyncs the "#N of M" counter and the
  // highlighted dot from what the track visually shows -- "#5 of 6" could
  // highlight the dot sitting 3rd from the left. Re-sort chronologically
  // for every visual/navigation concern in this component; each mention
  // still carries its own `significance` for the tooltip/detail footer, and
  // `originalRank` (1-indexed position in the significance-sorted prop)
  // preserves "how significant was this one" independent of screen position.
  // Root-caused live, 2026-08-15: matches the exact reported symptom
  // (counter/marker-position mismatch, "wrong" timestamp jumps from Next).
  const chronologicalMentions = useMemo(() => {
    return [...mentions]
      .map((mention, originalIndex) => ({ mention, originalRank: originalIndex + 1 }))
      .sort((entryA, entryB) => entryA.mention.seekSeconds - entryB.mention.seekSeconds);
  }, [mentions]);

  const activeMention = useMemo(() => {
    if (chronologicalMentions.length === 0) return null;
    return chronologicalMentions[Math.min(activeRankIndex, chronologicalMentions.length - 1)]?.mention ?? null;
  }, [chronologicalMentions, activeRankIndex]);

  const maxTime = useMemo(() => {
    if (videoDuration && videoDuration > 0) return videoDuration;
    if (mentions.length > 0) {
      const maxSeek = Math.max(...mentions.map((mention) => Math.max(mention.seekSeconds, mention.segmentEndSeconds)));
      return Math.max(maxSeek + 30, 300);
    }
    return 600;
  }, [videoDuration, mentions]);

  // Jump to specific mention (index into chronologicalMentions, not the
  // significance-sorted `mentions` prop -- see chronologicalMentions above).
  const handleSelectMention = useCallback(
    (index: number) => {
      if (index < 0 || index >= chronologicalMentions.length) return;
      setActiveRankIndex(index);
      const target = chronologicalMentions[index]?.mention;
      if (target) {
        issueSeek(target.seekSeconds);
      }
    },
    [chronologicalMentions, issueSeek],
  );

  const handlePrev = useCallback(() => {
    if (activeRankIndex > 0) {
      handleSelectMention(activeRankIndex - 1);
    }
  }, [activeRankIndex, handleSelectMention]);

  const handleNext = useCallback(() => {
    if (activeRankIndex < chronologicalMentions.length - 1) {
      handleSelectMention(activeRankIndex + 1);
    }
  }, [activeRankIndex, chronologicalMentions.length, handleSelectMention]);

  // Auto-segment playback watcher: polls currentPlaybackSeconds and advances
  // when Crossing activeMention.segmentEndSeconds
  useEffect(() => {
    if (!autoAdvance || !isPlaying || !activeMention || currentPlaybackSeconds === null) return;
    // Ignore stale currentPlaybackSeconds from before a manual seek we just
    // issued has actually taken effect -- see issueSeek/pendingSeekSeconds
    // above (Cubic review, PR #224).
    if (pendingSeekSeconds !== null) return;

    if (currentPlaybackSeconds >= activeMention.segmentEndSeconds) {
      if (activeRankIndex < chronologicalMentions.length - 1) {
        // Advance to the next mention in time
        const nextIndex = activeRankIndex + 1;
        setActiveRankIndex(nextIndex);
        const nextMention = chronologicalMentions[nextIndex]?.mention;
        if (nextMention) {
          issueSeek(nextMention.seekSeconds);
        }
      } else {
        // Reached end of the timeline -- pause auto advance
        useVideoStore.getState().setPlaying(false);
      }
    }
  }, [autoAdvance, isPlaying, activeMention, currentPlaybackSeconds, activeRankIndex, chronologicalMentions, pendingSeekSeconds, issueSeek]);

  // Do not render if no entity selected or zero mentions
  if (!entityId || !mentions || mentions.length <= 1) return null;

  return (
    <div
      role="region"
      aria-label={`Entity mention timeline for ${entityLabel || 'selected entity'}`}
      className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 shadow-sm transition-all"
    >
      {/* Header controls row */}
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Icon icon="solar:videocamera-record-bold" size={16} className="text-[var(--accent)] flex-shrink-0" />
          <span className="text-xs font-semibold text-[var(--ink)] truncate">
            {entityLabel || 'Selected Entity'}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-bold">
            {mentions.length} mentions
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto Advance Toggle */}
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(changeEvent) => setAutoAdvance(changeEvent.target.checked)}
              className="w-3.5 h-3.5 rounded border-[var(--line)] text-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] cursor-pointer"
            />
            Auto-advance segments
          </label>

          {/* Forward / Back Navigation */}
          <div className="flex items-center gap-1 bg-[var(--surface)] p-0.5 rounded-lg border border-[var(--line)]">
            <button
              type="button"
              disabled={activeRankIndex === 0}
              onClick={handlePrev}
              title="Previous mention"
              aria-label="Previous mention"
              className="p-1 rounded text-[var(--ink-secondary)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line)]/30 transition-colors"
            >
              <Icon icon="solar:alt-arrow-left-linear" size={14} />
            </button>
            <span className="text-[10px] font-mono font-medium px-1 text-[var(--ink-muted)]">
              #{activeRankIndex + 1} of {chronologicalMentions.length}
            </span>
            <button
              type="button"
              disabled={activeRankIndex >= chronologicalMentions.length - 1}
              onClick={handleNext}
              title="Next mention"
              aria-label="Next mention"
              className="p-1 rounded text-[var(--ink-secondary)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line)]/30 transition-colors"
            >
              <Icon icon="solar:alt-arrow-right-linear" size={14} />
            </button>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-[var(--ink-muted)] hover:text-[var(--ink)] rounded transition-colors"
              title="Dismiss timeline scrubber"
            >
              <Icon icon="solar:close-circle-linear" size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Scrubber track container */}
      <div className="relative w-full h-8 flex items-center bg-[var(--surface-quiet)] rounded-lg px-2 border border-[var(--line-faint)]">
        {/* Timeline base track */}
        <div className="absolute left-2 right-2 h-1.5 bg-[var(--line)] rounded-full overflow-hidden">
          {/* Active segment window highlight */}
          {activeMention && (
            <div
              className="absolute top-0 bottom-0 bg-[var(--accent)]/40 rounded-full"
              style={{
                left: `${Math.min(100, (activeMention.seekSeconds / maxTime) * 100)}%`,
                width: `${Math.max(
                  1,
                  Math.min(100 - (activeMention.seekSeconds / maxTime) * 100, ((activeMention.segmentEndSeconds - activeMention.seekSeconds) / maxTime) * 100)
                )}%`,
              }}
            />
          )}
        </div>

        {/* Individual Mention Markers */}
        <div className="absolute left-2 right-2 inset-y-0 pointer-events-none">
          {chronologicalMentions.map(({ mention, originalRank }, idx) => {
            const leftPct = Math.min(98, Math.max(1, (mention.seekSeconds / maxTime) * 100));
            const isActive = idx === activeRankIndex;
            return (
              <button
                key={`${mention.seekSeconds}-${idx}`}
                type="button"
                onClick={() => handleSelectMention(idx)}
                style={{ left: `${leftPct}%` }}
                title={`${mention.timestamp} (Rank #${originalRank}, ${mention.significance}% significance) · Dim. ${mention.dimensionNumber}`}
                aria-label={`Jump to mention at ${mention.timestamp}`}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-auto transition-transform hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 ${
                  isActive
                    ? 'w-4 h-4 rounded-full bg-[var(--accent)] shadow-[0_0_10px_rgba(59,130,246,0.8)] border-2 border-white z-10 scale-110'
                    : 'w-2.5 h-2.5 rounded-full bg-[var(--ink-muted)] hover:bg-[var(--accent)]'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Active mention detail footer */}
      {activeMention && (
        <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted)] mt-1.5 px-0.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[var(--ink-main)] font-semibold">
              {activeMention.timestamp}
            </span>
            <span>→</span>
            <span className="font-mono text-[var(--ink-secondary)]">
              {formatTimestamp(activeMention.segmentEndSeconds)}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-quiet)] border border-[var(--line)]">
              Dim. {activeMention.dimensionNumber}
            </span>
          </div>
          <div className="font-mono text-[10px]">
            Significance: <span className="text-[var(--accent)] font-semibold">{activeMention.significance}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
