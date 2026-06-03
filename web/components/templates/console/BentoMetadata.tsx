'use client';

import { motion } from 'framer-motion';
import { Icon, MonoLabel } from '../_shared/primitives';

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
    const n = typeof count === 'string' ? parseInt(count, 10) : count;
    if (isNaN(n)) return '0';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <motion.section
      variants={container}
      initial="hidden"
      animate="show"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(12, 1fr)",
        gridAutoRows: "minmax(80px, auto)",
        gap: 12,
        marginTop: 32,
      }}
    >
      {/* Title Card (Large) */}
      <motion.div
        variants={item}
        style={{
          gridColumn: "span 8",
          gridRow: "span 2",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <MonoLabel index="01">video intelligence context</MonoLabel>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--ink)", lineHeight: 1.2, marginTop: 12 }}>
            {title}
          </h2>
          <p style={{ color: "var(--accent)", fontSize: 14, fontWeight: 500, marginTop: 4 }}>
            {channelTitle}
          </p>
        </div>
      </motion.div>

      {/* View Count (Small) */}
      <motion.div
        variants={item}
        style={{
          gridColumn: "span 2",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <Icon icon="solar:eye-linear" size={20} style={{ color: "var(--ink-muted)", marginBottom: 4 }} />
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>{formatViews(viewCount)}</span>
        <span style={{ fontSize: 11, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Views</span>
      </motion.div>

      {/* Like Count (Small) */}
      <motion.div
        variants={item}
        style={{
          gridColumn: "span 2",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <Icon icon="solar:heart-linear" size={20} style={{ color: "var(--ink-muted)", marginBottom: 4 }} />
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>{formatViews(likeCount)}</span>
        <span style={{ fontSize: 11, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Likes</span>
      </motion.div>

      {/* Duration (Small) */}
      <motion.div
        variants={item}
        style={{
          gridColumn: "span 2",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <Icon icon="solar:clock-circle-linear" size={20} style={{ color: "var(--ink-muted)", marginBottom: 4 }} />
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>{formatDuration(duration)}</span>
        <span style={{ fontSize: 11, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Length</span>
      </motion.div>

      {/* Published (Small) */}
      <motion.div
        variants={item}
        style={{
          gridColumn: "span 2",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <Icon icon="solar:calendar-linear" size={20} style={{ color: "var(--ink-muted)", marginBottom: 4 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{new Date(publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
        <span style={{ fontSize: 11, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Date</span>
      </motion.div>
    </motion.section>
  );
}
