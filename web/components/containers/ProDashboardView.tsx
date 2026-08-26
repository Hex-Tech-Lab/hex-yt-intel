import { EntityMentionTimeline } from "@/components/templates/console/EntityMentionTimeline";
import { ConsoleTabSwitcher } from "./dashboard/ConsoleTabSwitcher";
import { ExecutiveSummary } from "@/components/organisms/ExecutiveSummary";
import { VisualizationPanel } from "@/components/dashboard/VisualizationPanel";
import { DimensionAccordion } from "@/components/dashboard/DimensionAccordion";
import { ShareButton } from "@/components/dashboard/ShareButton";
import { VideoPlayerCard } from "@/components/templates/console/VideoPlayerCard";
import { BentoMetadata } from "@/components/templates/console/BentoMetadata";
import {
  Icon,
  StatusBadge,
  ChapterChip,
} from "@/components/templates/_shared/primitives";
import type { KnowledgeGraph } from "@/lib/types/knowledge-graph";
import type { Dimension } from "@/components/templates/console/DimensionAccordion";

interface ProDashboardViewProps {
  status: string;
  analysisId: string | null;
  videoMetadata: any;
  timelineEntityData: any;
  setSelectedNodeId: (id: string | null) => void;
  consoleTab: "synthesis" | "graph";
  setConsoleTab: (t: "synthesis" | "graph") => void;
  graph: KnowledgeGraph;
  digest: any;
  digestLoading: boolean;
  mappedDigestData: any;
  partialInfo: any;
  TOTAL_DIMENSIONS: number;
  auxStatus: any;
  chaptersStatus: string;
  chapters: any[];
  dimensions: Dimension[];
  selectedDimensionKey: string | null;
  setSelectedDimensionKey: (k: string | null) => void;
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
  return (
    <>
      {hasHadVideo && (
        <div className="flex flex-col gap-1">
          <VideoPlayerCard />
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
