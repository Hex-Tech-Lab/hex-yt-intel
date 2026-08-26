import { ExecutiveSummary } from "@/components/organisms/ExecutiveSummary";
import { HighlightsScrubber } from "@/components/dashboard/HighlightsScrubber";
import { VideoPlayerCard } from "@/components/templates/console/VideoPlayerCard";
import { BentoMetadata } from "@/components/templates/console/BentoMetadata";
import dynamic from "next/dynamic";
import type { KnowledgeGraph } from "@/lib/types/knowledge-graph";

const WordCloud = dynamic(
  () =>
    import("@/components/templates/console/WordCloud").then((mod) => ({
      default: mod.WordCloud,
    })),
  {
    ssr: false,
    loading: () => <div className="w-full h-full bg-slate-900 animate-pulse" />,
  },
);

interface SimpleDashboardViewProps {
  status: string;
  analysisId: string | null;
  videoMetadata: any;
  digest: any;
  digestLoading: boolean;
  mappedDigestData: any;
  graph: KnowledgeGraph;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  hasHadVideo: boolean;
}

export function SimpleDashboardView({
  status,
  analysisId,
  videoMetadata,
  digest,
  digestLoading,
  mappedDigestData,
  graph,
  selectedNodeId,
  onSelectNode,
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
          
          {status === "complete" && graph.nodes.length > 0 && (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 h-[400px]">
              <WordCloud
                graph={graph}
                selectedId={selectedNodeId}
                onSelect={onSelectNode}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
