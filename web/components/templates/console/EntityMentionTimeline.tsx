'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { useVideoStore } from '@/store/useVideoStore';
import type { RankedEntityMention } from '@/lib/utils/entity-time-seek';

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

  const currentPlaybackSeconds = useVideoStore((s) => s.currentPlaybackSeconds);
  const isPlaying = useVideoStore((s) => s.isPlaying);

  // Reset active index when selected entity changes
  useEffect(() => {
    setActiveRankIndex(0);
  }, [entityId]);

  const activeMention = useMemo(() => {
    if (!mentions || mentions.length === 0) return null;
    return mentions[Math.min(activeRankIndex, mentions.length - 1)] ?? null;
  }, [mentions, activeRankIndex]);

  const maxTime = useMemo(() => {
    if (videoDuration && videoDuration > 0) return videoDuration;
    if (mentions.length > 0) {
      const maxSeek = Math.max(...mentions.map((m) => Math.max(m.seekSeconds, m.segmentEndSeconds)));
      return Math.max(maxSeek + 30, 300);
    }
    return 600;
  }, [videoDuration, mentions]);

  // Jump to specific mention
  const handleSelectMention = useCallback(
    (index: number) => {
      if (index < 0 || index >= mentions.length) return;
      setActiveRankIndex(index);
      const target = mentions[index];
      if (target) {
        useVideoStore.getState().setSeekTo(target.seekSeconds);
      }
    },
    [mentions],
  );

  const handlePrev = useCallback(() => {
    if (activeRankIndex > 0) {
      handleSelectMention(activeRankIndex - 1);
    }
  }, [activeRankIndex, handleSelectMention]);

  const handleNext = useCallback(() => {
    if (activeRankIndex < mentions.length - 1) {
      handleSelectMention(activeRankIndex + 1);
    }
  }, [activeRankIndex, mentions.length, handleSelectMention]);

  // Auto-segment playback watcher: polls currentPlaybackSeconds and advances
  // when Crossing activeMention.segmentEndSeconds
  useEffect(() => {
    if (!autoAdvance || !isPlaying || !activeMention || currentPlaybackSeconds === null) return;

    if (currentPlaybackSeconds >= activeMention.segmentEndSeconds) {
      if (activeRankIndex < mentions.length - 1) {
        // Advance to next ranked mention
        const nextIndex = activeRankIndex + 1;
        setActiveRankIndex(nextIndex);
        const nextMention = mentions[nextIndex];
        if (nextMention) {
          useVideoStore.getState().setSeekTo(nextMention.seekSeconds);
        }
      } else {
        // Reached end of ranked mentions sequence -- pause auto advance
        useVideoStore.getState().setPlaying(false);
      }
    }
  }, [autoAdvance, isPlaying, activeMention, currentPlaybackSeconds, activeRankIndex, mentions]);

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
              onChange={(e) => setAutoAdvance(e.target.checked)}
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
              title="Previous ranked mention"
              aria-label="Previous ranked mention"
              className="p-1 rounded text-[var(--ink-secondary)] hover:text-[var(--ink)] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[var(--line)]/30 transition-colors"
            >
              <Icon icon="solar:alt-arrow-left-linear" size={14} />
            </button>
            <span className="text-[10px] font-mono font-medium px-1 text-[var(--ink-muted)]">
              #{activeRankIndex + 1} of {mentions.length}
            </span>
            <button
              type="button"
              disabled={activeRankIndex >= mentions.length - 1}
              onClick={handleNext}
              title="Next ranked mention"
              aria-label="Next ranked mention"
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
          {mentions.map((m, idx) => {
            const leftPct = Math.min(98, Math.max(1, (m.seekSeconds / maxTime) * 100));
            const isActive = idx === activeRankIndex;
            return (
              <button
                key={`${m.seekSeconds}-${idx}`}
                type="button"
                onClick={() => handleSelectMention(idx)}
                style={{ left: `${leftPct}%` }}
                title={`Rank #${idx + 1}: ${m.timestamp} (${m.significance}% significance) · Dim. ${m.dimensionNumber}`}
                aria-label={`Jump to mention #${idx + 1} at ${m.timestamp}`}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-auto transition-transform hover:scale-125 focus:outline-none ${
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
              {Math.floor(activeMention.segmentEndSeconds / 60)}:
              {String(Math.floor(activeMention.segmentEndSeconds % 60)).padStart(2, '0')}
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--surface-quiet)] border border-[var(--line)]">
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
