import { ExecutiveSummary } from "@/components/organisms/ExecutiveSummary";
import { HighlightsScrubber } from "@/components/dashboard/HighlightsScrubber";
import { VideoPlayerCard } from "@/components/templates/console/VideoPlayerCard";
import { BentoMetadata } from "@/components/templates/console/BentoMetadata";
import {
  PartialAnalysisWarning,
  type PartialAnalysisInfo,
} from "@/components/dashboard/PartialAnalysisWarning";

interface SimpleDashboardViewProps {
  status: string;
  analysisId: string | null;
  videoMetadata: any;
  digest: any;
  digestLoading: boolean;
  mappedDigestData: any;
  partialInfo: PartialAnalysisInfo | null;
  TOTAL_DIMENSIONS: number;
  hasHadVideo: boolean;
}

export function SimpleDashboardView({
  status,
  analysisId,
  videoMetadata,
  digest,
  digestLoading,
  mappedDigestData,
  partialInfo,
  TOTAL_DIMENSIONS,
  hasHadVideo,
}: SimpleDashboardViewProps) {
  return (
    <>
      {hasHadVideo && (
        <div className="flex flex-col gap-1">
          <VideoPlayerCard />
          {status === "complete" && analysisId && (
            <HighlightsScrubber
              analysisId={analysisId}
              videoDurationSeconds={videoMetadata?.duration ?? null}
              digestLoading={digestLoading}
            />
          )}
          {videoMetadata && (
            <BentoMetadata
              title={videoMetadata.title}
              channelTitle={videoMetadata.channelTitle}
              viewCount={videoMetadata.viewCount}
              likeCount={videoMetadata.likeCount}
              duration={videoMetadata.duration || 0}
              publishedAt={videoMetadata.publishedAt}
              description={videoMetadata.description}
            />
          )}
        </div>
      )}

      {status !== "idle" && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[var(--ink-secondary)] font-mono text-xs font-semibold py-1">
              SYNTHESIS OVERVIEW
            </div>
          </div>

          {status === "complete" && (digest || digestLoading) && (
            <ExecutiveSummary
              data={mappedDigestData}
              loading={digestLoading}
            />
          )}

          <PartialAnalysisWarning
            partialInfo={partialInfo}
            totalDimensions={TOTAL_DIMENSIONS}
          />
        </div>
      )}
    </>
  );
}
