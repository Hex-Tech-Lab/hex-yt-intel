'use client';

import { useEffect, useId, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@astryxdesign/core';
import { Icon, MonoLabel } from '@/components/templates/_shared/primitives';

const MotionCard = motion.create(Card);

// Below this length a 2-line clamp wouldn't hide anything anyway -- skip the
// toggle rather than pay for a layout-measurement effect just to find out.
const DESCRIPTION_EXPAND_THRESHOLD = 140;

// Deliberately greedy -- boundary punctuation is trimmed afterward by
// trimUrlTrailingPunctuation, which distinguishes balanced URL punctuation
// (e.g. Wikipedia's .../Function_(mathematics)) from real sentence-ending
// punctuation. A single exclusion character class can't make that
// distinction (review finding, 2026-09-07: the prior pattern truncated any
// URL ending in a balanced ), ], or similar).
const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;

/** Strips trailing sentence punctuation from a matched URL, keeping a
 *  balanced closing `)`/`]` (one whose opener appears earlier in the URL). */
export function trimUrlTrailingPunctuation(url: string): string {
  let trimmed = url;
  for (;;) {
    const last = trimmed[trimmed.length - 1];
    if (!last) return trimmed;
    if (last === ')' || last === ']') {
      const open = last === ')' ? '(' : '[';
      const opens = trimmed.split(open).length - 1;
      const closes = trimmed.split(last).length - 1;
      if (closes <= opens) return trimmed; // balanced -- part of the URL
      trimmed = trimmed.slice(0, -1);
      continue;
    }
    if (/[.,;:!?'"]/.test(last)) {
      trimmed = trimmed.slice(0, -1);
      continue;
    }
    return trimmed;
  }
}

// Splits on URLs and renders them as real anchors via plain JSX text nodes --
// deliberately not raw-HTML injection, so untrusted YouTube description text can't inject markup.
const linkifyDescription = (text: string) => {
  const parts = text.split(URL_PATTERN);
  return parts.flatMap((part, i) => {
    if (!(part.startsWith('http://') || part.startsWith('https://'))) return [part];
    const url = trimUrlTrailingPunctuation(part);
    // Not a truncation -- extracts the suffix trimUrlTrailingPunctuation
    // removed, rendered as plain text right after the anchor (see below),
    // so nothing is lost and no ellipsis is needed.
    const trailingPunctuation = part.slice(/* no ellipsis: full text is preserved below */ url.length);
    const anchor = (
      <a
        key={`${url}-${i}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--accent)] underline hover:no-underline break-all"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        {url}
      </a>
    );
    return trailingPunctuation ? [anchor, trailingPunctuation] : [anchor];
  });
};

const toCount = (count: string | number | undefined): number =>
  typeof count === 'number' ? count : parseInt(count ?? '', 10);

/** (likes + comments) / views as a percentage; '—' when views are unknown or zero. */
export function formatEngagement(views: string | number, likes: string | number, comments?: string | number): string {
  const viewNum = toCount(views);
  if (!Number.isFinite(viewNum) || viewNum <= 0) return '—';
  const interactions = (Number.isFinite(toCount(likes)) ? toCount(likes) : 0) + (Number.isFinite(toCount(comments)) ? toCount(comments) : 0);
  const pct = (interactions / viewNum) * 100;
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

export interface BentoMetadataProps {
  title: string;
  channelTitle: string;
  viewCount: string | number;
  likeCount: string | number;
  /** Optional: older callers and restored rows may not carry it. */
  commentCount?: string | number;
  duration: number;
  publishedAt: string;
  description?: string;
}

/**
 * Bento-style Metadata Display
 * Inspired by 21st.dev (shadcn/ui layout)
 * Integrated with Framer Motion for staggered entry.
 */
export function BentoMetadata({
  title,
  channelTitle,
  viewCount,
  likeCount,
  commentCount,
  duration,
  publishedAt,
  description,
}: BentoMetadataProps) {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const canExpandDescription = Boolean(description && description.length > DESCRIPTION_EXPAND_THRESHOLD);
  const descriptionId = useId();

  // Reset on every new description (switching videos, restoring a different
  // analysis) -- this component instance is reused across analyses, so
  // without this an expanded state from a prior video would carry over.
  useEffect(() => {
    setDescriptionExpanded(false);
  }, [description]);

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
      },
    },
  };

  const item = {
    hidden: { opacity: 0, scale: 0.98 },
    show: { opacity: 1, scale: 1, transition: { duration: 0.3 } },
  };

  const formatViews = (count: string | number) => {
    const countNum = typeof count === 'string' ? parseInt(count, 10) : count;
    if (isNaN(countNum)) return '0';
    if (countNum >= 1000000) return `${(countNum / 1000000).toFixed(1)}M`;
    if (countNum >= 1000) return `${(countNum / 1000).toFixed(1)}K`;
    return countNum.toString();
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return hours > 0 ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` : `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // T11: six compact stat cards (3x2 beside the title on xl). Engagement is
  // (likes + comments) / views from YouTube's own counts -- value only.
  const stats = [
    { icon: 'solar:eye-linear', value: formatViews(viewCount), label: 'Views' },
    { icon: 'solar:heart-linear', value: formatViews(likeCount), label: 'Likes' },
    { icon: 'solar:chat-round-dots-linear', value: commentCount === undefined ? '—' : formatViews(commentCount), label: 'Comments' },
    { icon: 'solar:graph-up-linear', value: formatEngagement(viewCount, likeCount, commentCount), label: 'Engagement' },
    { icon: 'solar:clock-circle-linear', value: formatDuration(duration), label: 'Length' },
    { icon: 'solar:calendar-linear', value: new Date(publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }), label: 'Date' },
  ];

  return (
    <motion.section
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-12 gap-3 mt-6 sm:mt-8"
    >
      {/* Title Card (Large) */}
      <MotionCard
        variants={item}
        variant="default"
        padding={0}
        className="col-span-2 sm:col-span-3 xl:col-span-6 xl:row-span-2 min-w-0 flex flex-col justify-between gap-3 p-3 sm:p-4"
      >
        <MonoLabel index="01">video intelligence context</MonoLabel>
        <div className="min-w-0">
          <h2 className="mt-3 text-[22px] sm:text-2xl font-bold tracking-[-0.02em] leading-tight text-[var(--ink)] break-words">
            {title}
          </h2>
          <p className="mt-1 text-sm font-medium text-[var(--accent)] break-words">
            {channelTitle}
          </p>
          {description && (
            <div className="mt-2">
              {/* max-height needs a numeric start to animate (line-clamp is max-height:none);
                  the expanded region scrolls, so it must be keyboard-focusable. */}
              <div
                id={descriptionId}
                data-testid="bento-description"
                tabIndex={descriptionExpanded ? 0 : undefined}
                className={`text-xs text-[var(--ink-muted)] break-words whitespace-pre-line transition-[max-height] duration-[var(--motion-duration-description)] ease-out motion-reduce:transition-none ${
                  !canExpandDescription
                    ? ''
                    : descriptionExpanded
                      ? 'max-h-[var(--description-max-height)] overflow-y-auto pr-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2'
                      : 'max-h-[var(--description-collapsed-height)] overflow-hidden'
                }`}
              >
                {linkifyDescription(description)}
              </div>
              {canExpandDescription && (
                <button
                  type="button"
                  onClick={() => setDescriptionExpanded((prev) => !prev)}
                  aria-expanded={descriptionExpanded}
                  aria-controls={descriptionId}
                  className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
                >
                  <span>{descriptionExpanded ? 'Show less' : 'Show more'}</span>
                  <Icon icon={descriptionExpanded ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'} size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </MotionCard>

      {stats.map((stat) => (
        // stat tiles slide left while the description is open, mirroring its expansion
        <MotionCard
          key={stat.label}
          variants={item}
          variant="default"
          padding={0}
          className={`col-span-1 xl:col-span-2 min-w-0 flex flex-col items-center justify-center text-center p-2.5 transition-transform duration-[var(--motion-duration-description)] ease-out motion-reduce:transition-none ${
            descriptionExpanded ? 'xl:-translate-x-3' : 'xl:translate-x-0'
          }`}
        >
          <Icon icon={stat.icon} size={16} className="mb-0.5 text-[var(--ink-muted)]" />
          <span className="text-[15px] font-bold text-[var(--ink)]">{stat.value}</span>
          <span className="text-[10px] uppercase tracking-[0.05em] text-[var(--ink-muted)]">{stat.label}</span>
        </MotionCard>
      ))}
    </motion.section>
  );
}
