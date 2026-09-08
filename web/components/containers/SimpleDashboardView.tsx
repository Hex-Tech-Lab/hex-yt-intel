import { ExecutiveSummary } from "@/components/organisms/ExecutiveSummary";
import { HighlightsScrubber } from "@/components/dashboard/HighlightsScrubber";
import { VideoPlayerCard } from "@/components/templates/console/VideoPlayerCard";
import { BentoMetadata } from "@/components/templates/console/BentoMetadata";
import { Icon } from "@/components/templates/_shared/primitives";

interface PartialInfo {
  presentCount: number;
  missing: number[];
}

interface SimpleDashboardViewProps {
  status: string;
  analysisId: string | null;
  videoMetadata: any;
  digest: any;
  digestLoading: boolean;
  mappedDigestData: any;
  partialInfo: PartialInfo | null;
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

          {partialInfo && (
            <div
              role="status"
              className="rounded-lg border border-[var(--warn)]/60 bg-[var(--warn)]/10 px-3.5 py-2.5 text-xs leading-relaxed text-[var(--ink-main)] shadow-[0_0_14px_rgba(245,158,11,0.25)] flex items-center gap-2.5"
            >
              <Icon
                icon="solar:danger-triangle-linear"
                size={16}
                className="text-[var(--warn)] flex-shrink-0"
              />
              <div>
                <span className="font-mono font-bold text-[var(--warn)]">
                  Partial analysis warning
                </span>
                {` — ${partialInfo.presentCount} of ${TOTAL_DIMENSIONS} dimensions generated. `}
                <span className="text-[var(--ink-muted)]">
                  Missing: {partialInfo.missing.join(", ")}.
                </span>
                {" Use Re-analyze to attempt the rest."}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
