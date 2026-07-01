'use client';

import { motion } from 'framer-motion';
import { Icon, MonoLabel } from '@/components/templates/_shared/primitives';

export interface BentoMetadataProps {
  title: string;
  channelTitle: string;
  viewCount: string | number;
  likeCount: string | number;
  duration: number;
  publishedAt: string;
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
  duration,
  publishedAt,
}: BentoMetadataProps) {
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

  return (
    <motion.section
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-12 gap-3 mt-6 sm:mt-8"
    >
      {/* Title Card (Large) */}
      <motion.div
        variants={item}
        className="col-span-2 sm:col-span-4 xl:col-span-8 xl:row-span-2 min-w-0 flex flex-col justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6"
      >
        <MonoLabel index="01">video intelligence context</MonoLabel>
        <div className="min-w-0">
          <h2 className="mt-3 text-[22px] sm:text-2xl font-bold tracking-[-0.02em] leading-tight text-[var(--ink)] break-words">
            {title}
          </h2>
          <p className="mt-1 text-sm font-medium text-[var(--accent)] break-words">
            {channelTitle}
          </p>
        </div>
      </motion.div>

      {/* View Count (Small) */}
      <motion.div
        variants={item}
        className="col-span-1 xl:col-span-2 min-w-0 flex flex-col items-center justify-center text-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"
      >
        <Icon icon="solar:eye-linear" size={20} className="mb-1 text-[var(--ink-muted)]" />
        <span className="text-lg font-bold text-[var(--ink)]">{formatViews(viewCount)}</span>
        <span className="text-[11px] uppercase tracking-[0.05em] text-[var(--ink-muted)]">Views</span>
      </motion.div>

      {/* Like Count (Small) */}
      <motion.div
        variants={item}
        className="col-span-1 xl:col-span-2 min-w-0 flex flex-col items-center justify-center text-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"
      >
        <Icon icon="solar:heart-linear" size={20} className="mb-1 text-[var(--ink-muted)]" />
        <span className="text-lg font-bold text-[var(--ink)]">{formatViews(likeCount)}</span>
        <span className="text-[11px] uppercase tracking-[0.05em] text-[var(--ink-muted)]">Likes</span>
      </motion.div>

      {/* Duration (Small) */}
      <motion.div
        variants={item}
        className="col-span-1 xl:col-span-2 min-w-0 flex flex-col items-center justify-center text-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"
      >
        <Icon icon="solar:clock-circle-linear" size={20} className="mb-1 text-[var(--ink-muted)]" />
        <span className="text-lg font-bold text-[var(--ink)]">{formatDuration(duration)}</span>
        <span className="text-[11px] uppercase tracking-[0.05em] text-[var(--ink-muted)]">Length</span>
      </motion.div>

      {/* Published (Small) */}
      <motion.div
        variants={item}
        className="col-span-1 xl:col-span-2 min-w-0 flex flex-col items-center justify-center text-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"
      >
        <Icon icon="solar:calendar-linear" size={20} className="mb-1 text-[var(--ink-muted)]" />
        <span className="text-[13px] font-bold text-[var(--ink)]">{new Date(publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
        <span className="text-[11px] uppercase tracking-[0.05em] text-[var(--ink-muted)]">Date</span>
      </motion.div>
    </motion.section>
  );
}
