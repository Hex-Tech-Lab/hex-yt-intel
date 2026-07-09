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

export function DashboardStats({ hasVideo, videoMetadata }: DashboardStatsProps) {
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
