'use client';

import { useMemo } from 'react';
import { ConsoleTabSwitcher } from './ConsoleTabSwitcher';
import { ExecutiveDigestCard } from '@/components/dashboard/ExecutiveDigestCard';
import { PersonaSelector } from '@/components/templates/console/PersonaSelector';
import { DimensionAccordion } from '@/components/dashboard/DimensionAccordion';
import { VisualizationPanel } from '@/components/dashboard/VisualizationPanel';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import type { Dimension } from '@/components/templates/console/DimensionAccordion';
import type { StoredExecutiveDigest } from '@/lib/ports/ExecutiveDigestPorts';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';

export interface DashboardMainContentProps {
  status: 'idle' | 'analyzing' | 'downloading' | 'parsing' | 'complete' | 'error';
  consoleTab: 'synthesis' | 'graph';
  onTabChange: (tab: 'synthesis' | 'graph') => void;
  dimensions: Dimension[];
  selectedDimensionKey: string | null;
  onSelectDimension: (key: string | null) => void;
  digest: StoredExecutiveDigest | null;
  digestLoading: boolean;
  partialInfo: { presentCount: number; missing: number[] } | null;
  graph: KnowledgeGraph;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onFocusNode: (id: string | null) => void;
}

export function DashboardMainContent({
  status,
  consoleTab,
  onTabChange,
  dimensions,
  selectedDimensionKey,
  onSelectDimension,
  digest,
  digestLoading,
  partialInfo,
  graph,
  selectedNodeId,
  onSelectNode,
  onFocusNode,
}: DashboardMainContentProps) {
  const partialInfoContent = useMemo(() => {
    if (!partialInfo) return null;
    return (
      <div
        role="status"
        className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-xs leading-relaxed text-[var(--ink-secondary)]"
      >
        <span className="font-mono font-semibold text-[var(--accent-ink)]">Partial analysis</span>
        {` — ${partialInfo.presentCount} of ${TOTAL_DIMENSIONS} dimensions generated. `}
        <span className="text-[var(--ink-muted)]">Missing: {partialInfo.missing.join(', ')}.</span>
        {' Use Re-analyze to attempt the rest.'}
      </div>
    );
  }, [partialInfo]);

  const tabSwitcher = useMemo(() => {
    return (
      <ConsoleTabSwitcher
        activeTab={consoleTab}
        hasGraph={graph.nodes.length > 0}
        onTabChange={onTabChange}
      />
    );
  }, [consoleTab, graph.nodes.length, onTabChange]);

  const digestCard = useMemo(() => {
    if (status !== 'complete' || (!digest && !digestLoading)) return null;
    return <ExecutiveDigestCard digest={digest} loading={digestLoading} />;
  }, [status, digest, digestLoading]);

  const personaSection = useMemo(() => {
    if (status !== 'complete' || dimensions.length === 0) return null;
    return <PersonaSelector />;
  }, [status, dimensions.length]);

  const dimensionAccordion = useMemo(
    () => (
      <DimensionAccordion
        dimensions={dimensions}
        selectedDimensionKey={selectedDimensionKey}
        onSelectDimension={onSelectDimension}
        status={status}
      />
    ),
    [dimensions, selectedDimensionKey, onSelectDimension, status]
  );

  const visualizationPanel = useMemo(
    () => (
      <VisualizationPanel
        graph={graph}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        onFocusNode={onFocusNode}
      />
    ),
    [graph, selectedNodeId, onSelectNode, onFocusNode]
  );

  if (status === 'idle') return null;

  return (
    <div className="flex flex-col gap-4">
      {tabSwitcher}
      {consoleTab === 'synthesis' ? (
        <>
          {digestCard}
          {partialInfoContent}
          {personaSection}
          {dimensionAccordion}
        </>
      ) : (
        visualizationPanel
      )}
    </div>
  );
}
