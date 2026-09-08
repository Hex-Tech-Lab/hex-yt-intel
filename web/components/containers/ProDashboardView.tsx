import { EntityMentionTimeline } from "@/components/templates/console/EntityMentionTimeline";
import { ConsoleTabSwitcher } from "./dashboard/ConsoleTabSwitcher";
import { ExecutiveSummary } from "@/components/organisms/ExecutiveSummary";
import { VisualizationPanel } from "@/components/dashboard/VisualizationPanel";
import { DimensionAccordion } from "@/components/dashboard/DimensionAccordion";
import { ShareButton } from "@/components/dashboard/ShareButton";
import { VideoPlayerCard } from "@/components/templates/console/VideoPlayerCard";
import { HighlightsScrubber } from "@/components/dashboard/HighlightsScrubber";
import { BentoMetadata } from "@/components/templates/console/BentoMetadata";
import {
  StatusBadge,
  ChapterChip,
  HighlightsChip,
} from "@/components/templates/_shared/primitives";
import {
  PartialAnalysisWarning,
  type PartialAnalysisInfo,
} from "@/components/dashboard/PartialAnalysisWarning";
import { useHighlightsStatus } from "@/lib/hooks/useHighlightsStatus";
import type { KnowledgeGraph } from "@/lib/types/knowledge-graph";
import type { Dimension } from "@/components/templates/console/DimensionAccordion";
import type { VideoMetadata } from "@/lib/types";
import type { StoredExecutiveDigest } from "@/lib/ports/ExecutiveDigestPorts";
import type { ExecutiveSummaryData } from "@/components/organisms/ExecutiveSummary";
import type { AuxElementStatus } from "@/hooks/useAuxElementStatus";
import type { ChapterEntry } from "@/store/useChaptersStore";
import type { RankedEntityMention } from "@/lib/utils/entity-time-seek";

interface ProDashboardViewProps {
  status: string;
  analysisId: string | null;
  videoMetadata: VideoMetadata | null;
  timelineEntityData: {
    entityId: string;
    entityLabel: string;
    mentions: RankedEntityMention[];
  } | null;
  setSelectedNodeId: (id: string | null) => void;
  consoleTab: "synthesis" | "graph";
  setConsoleTab: (tab: "synthesis" | "graph") => void;
  graph: KnowledgeGraph;
  digest: StoredExecutiveDigest | null;
  digestLoading: boolean;
  mappedDigestData: ExecutiveSummaryData | null;
  partialInfo: PartialAnalysisInfo | null;
  TOTAL_DIMENSIONS: number;
  auxStatus: AuxElementStatus | null;
  chaptersStatus: string;
  chapters: ChapterEntry[];
  dimensions: Dimension[];
  selectedDimensionKey: string | null;
  setSelectedDimensionKey: (dimensionKey: string | null) => void;
  selectedNodeId: string | null;
  handleSelectNode: (id: string | null) => void;
  hasHadVideo: boolean;
}

export function ProDashboardView({
  status,
  analysisId,
  videoMetadata,
  timelineEntityData,
  setSelectedNodeId,
  consoleTab,
  setConsoleTab,
  graph,
  digest,
  digestLoading,
  mappedDigestData,
  partialInfo,
  TOTAL_DIMENSIONS,
  auxStatus,
  chaptersStatus,
  chapters,
  dimensions,
  selectedDimensionKey,
  setSelectedDimensionKey,
  selectedNodeId,
  handleSelectNode,
  hasHadVideo,
}: ProDashboardViewProps) {
  const { hasHighlights, count: highlightsCount } = useHighlightsStatus(analysisId, status, digestLoading);
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
          {timelineEntityData && (
            <EntityMentionTimeline
              entityId={timelineEntityData.entityId}
              entityLabel={timelineEntityData.entityLabel}
              mentions={timelineEntityData.mentions}
              videoDuration={videoMetadata?.duration ?? null}
              onClose={() => setSelectedNodeId(null)}
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
            <ConsoleTabSwitcher
              activeTab={consoleTab}
              hasGraph={graph.nodes.length > 0}
              onTabChange={setConsoleTab}
            />
            {status === "complete" && analysisId && (
              <ShareButton analysisId={analysisId} />
            )}
          </div>

          {consoleTab === "synthesis" ? (
            <>
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
              {status === "complete" && auxStatus && (
                <div
                  className="flex flex-wrap gap-2"
                  role="status"
                  aria-label="Auxiliary data status"
                >
                  <StatusBadge
                    status={digest ? "done" : "idle"}
                    label="Digest"
                    tooltip="Executive summary digest generated from analysis"
                  />
                  <StatusBadge
                    status={auxStatus.description ? "done" : "idle"}
                    label="Description"
                    tooltip="YouTube video description ingested"
                  />
                  <StatusBadge
                    status={auxStatus.channelMeta ? "done" : "idle"}
                    label="Channel Meta"
                    tooltip="Channel metadata and statistics enriched"
                  />
                  <StatusBadge
                    status={auxStatus.comments ? "done" : "idle"}
                    label="Comments"
                    tooltip="Top audience comments sampled and analyzed"
                  />
                  <ChapterChip
                    hasChapters={
                      chaptersStatus === "loaded" ? chapters.length > 0 : null
                    }
                  />
                  <HighlightsChip hasHighlights={hasHighlights} count={highlightsCount} />
                </div>
              )}
              <DimensionAccordion
                dimensions={dimensions}
                selectedDimensionKey={selectedDimensionKey}
                onSelectDimension={setSelectedDimensionKey}
                status={status}
              />
            </>
          ) : (
            <VisualizationPanel
              graph={graph}
              selectedNodeId={selectedNodeId}
              onSelectNode={handleSelectNode}
              onFocusNode={setSelectedNodeId}
            />
          )}
        </div>
      )}
    </>
  );
}
