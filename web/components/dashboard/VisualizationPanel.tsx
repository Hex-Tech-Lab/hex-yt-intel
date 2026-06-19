'use client';

import { KnowledgeGraphCanvas } from '@/components/templates/console/KnowledgeGraphCanvas';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';

interface VisualizationPanelProps {
  graph: KnowledgeGraph;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onFocusNode: (id: string) => void;
}

export function VisualizationPanel({
  graph,
  selectedNodeId,
  onSelectNode,
  onFocusNode,
}: VisualizationPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <KnowledgeGraphCanvas
          graph={graph}
          selectedId={selectedNodeId}
          onSelect={onSelectNode}
          onFocus={onFocusNode}
          height={520}
        />
      </div>
      <p className="text-[var(--ink-muted)] font-mono text-[10px] uppercase tracking-wider pl-1">
        Left-click node to inspect · drag to pan/reposition · scroll to zoom
      </p>
    </div>
  );
}
