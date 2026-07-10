'use client';

import { useMemo } from 'react';
import { VideoPlayerCard } from '@/components/templates/console/VideoPlayerCard';
import { BentoMetadata } from '@/components/templates/console/BentoMetadata';

export interface DashboardStatsProps {
  hasVideo: boolean;
  videoMetadata?: {
    title: string;
    channelTitle: string;
    viewCount: number;
    likeCount: number;
    duration: number;
    publishedAt: string;
  };
}

/**
 * DashboardStats
 * Renders video player and metadata KPIs (view/like counts, duration, etc.)
 * Memoized to prevent re-renders when parent state changes.
 */
export function DashboardStats({ hasVideo, videoMetadata }: DashboardStatsProps) {
  // Memoize the entire section to avoid re-renders from parent state changes
  const content = useMemo(
    () => (
      <div className="flex flex-col gap-3">
        <VideoPlayerCard />
        {videoMetadata && (
          <BentoMetadata
            title={videoMetadata.title}
            channelTitle={videoMetadata.channelTitle}
            viewCount={videoMetadata.viewCount}
            likeCount={videoMetadata.likeCount}
            duration={videoMetadata.duration || 0}
            publishedAt={videoMetadata.publishedAt}
          />
        )}
      </div>
    ),
    [videoMetadata]
  );

  if (!hasVideo) return null;

  return content;
}
