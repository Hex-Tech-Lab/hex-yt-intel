'use client';

import { useMemo } from 'react';
import { Card as AstryxCard, Tooltip } from '@astryxdesign/core';
import { MonoLabel, Icon } from '@/components/templates/_shared/primitives';
import { nodeIntelligence } from '@/lib/intelligence/knowledge-graph';
import type { KnowledgeGraph, RelatedRef, RelationInsight } from '@/lib/types/knowledge-graph';

// See /docs/ui/intelligence-panel.md

export interface IntelligencePanelProps {
  graph: KnowledgeGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  insights?: RelationInsight[];
  insightsLoading?: boolean;
}

function StanceSection({
  insights,
  loading,
  selectedDim,
  onSelect,
}: {
  insights: RelationInsight[];
  loading: boolean;
  selectedDim: number | null;
  onSelect: (id: string | null) => void;
}) {
  const shown = selectedDim
    ? insights.filter((i) => i.source === selectedDim || i.target === selectedDim)
    : insights;

  if (!loading && shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.75 text-[var(--accent-ink)] font-mono text-xs tracking-tight uppercase">
        <Icon icon="solar:branching-paths-up-linear" size={14} />
        Stance intelligence
      </span>
      {loading ? (
        <div className="text-[var(--ink-muted)] font-mono text-[10px] tracking-tight">analyzing tensions…</div>
      ) : (
        shown.map((i) => {
          const contra = i.kind === 'contrarian';
          const colorClass = contra ? "text-[var(--warn)]" : "text-[var(--ink-secondary)]";
          const bgClass = contra ? "bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.25)]" : "bg-[rgb(11_14_20_/_0.5)] border-[var(--line)]";
          
          return (
            <AstryxCard
              key={`${i.kind}-${i.source}-${i.target}`}
              variant="transparent"
              padding={0}
              className={`border ${bgClass} rounded-xl p-2 px-3`}
            >
              <div className="flex items-center gap-1.5 mb-1.25">
                <Icon icon={contra ? 'solar:bolt-circle-linear' : 'solar:arrow-right-up-linear'} size={13} className={colorClass} />
                <span className={`font-mono text-[10px] uppercase tracking-[0.05em] ${colorClass}`}>{i.kind}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <button
                  onClick={() => onSelect(`dim-${i.source}`)}
                  className="bg-transparent border-none text-[var(--ink)] text-xs font-semibold cursor-pointer p-0 hover:text-[var(--accent)] transition-colors"
                >
                  {i.sourceLabel}
                </button>
                <Icon icon="solar:arrow-right-linear" size={12} className="text-[var(--ink-muted)]" />
                <button
                  onClick={() => onSelect(`dim-${i.target}`)}
                  className="bg-transparent border-none text-[var(--ink)] text-xs font-semibold cursor-pointer p-0 hover:text-[var(--accent)] transition-colors"
                >
                  {i.targetLabel}
                </button>
              </div>
              <p className="m-0 text-[var(--ink-secondary)] text-xs leading-relaxed">{i.rationale}</p>
            </AstryxCard>
          );
        })
      )}
    </div>
  );
}

const CARD = {
  related: { label: 'Related', icon: 'solar:link-round-angle-linear', color: 'var(--accent)', hint: 'Shares core concepts' },
  similar: { label: 'Similar', icon: 'solar:copy-linear', color: 'var(--accent)', hint: 'Near-duplicate framing' },
  tangents: { label: 'Tangents', icon: 'solar:arrow-right-up-linear', color: 'var(--ink-secondary)', hint: 'Adjacent but divergent' },
  contrarian: { label: 'Contrarian', icon: 'solar:bolt-circle-linear', color: 'var(--warn)', hint: 'Opposing stance (heuristic)' },
} as const;

function StrengthBar({ value, color }: { value: number; color: string }) {
  return (
    <span className="inline-block w-[42px] h-1 rounded-sm bg-[rgb(51_65_85_/_0.4)] overflow-hidden">
      <span className="block h-full transition-all duration-500" style={{ width: `${Math.round(Math.min(1, value) * 100)}%`, background: color }} />
    </span>
  );
}

function RefRow({ r, color, onSelect }: { r: RelatedRef; color: string; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(r.nodeId)}
      className="flex items-center justify-between w-full gap-2 p-1.5 px-2 rounded-lg border border-transparent bg-transparent text-[var(--ink-secondary)] cursor-pointer font-mono text-xs text-left transition-all hover:bg-[rgb(26_31_43_/_0.6)] hover:border-[var(--line)]"
    >
      <span className="flex items-center gap-1.75 min-w-0">
        <span className="text-[var(--ink-muted)] text-[10px]">{String(r.dimension).padStart(2, '0')}</span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 text-[var(--ink-muted)] text-[10px] font-mono text-left transition-colors">{r.label}</span>
      </span>
      <StrengthBar value={r.strength} color={color} />
    </button>
  );
}

function RelationCard({
  kind,
  refs,
  onSelect,
}: {
  kind: keyof typeof CARD;
  refs: RelatedRef[];
  onSelect: (id: string) => void;
}) {
  const meta = CARD[kind];
  return (
    <AstryxCard variant="transparent" padding={0} className="border border-[var(--line)] rounded-xl overflow-hidden bg-[rgb(11_14_20_/_0.5)]">
      <div className="flex items-center justify-between p-2 px-3 border-b border-[var(--line)]">
        <span className="flex items-center gap-1.75 text-[11.5px] font-mono tracking-tight uppercase" style={{ color: meta.color }}>
          <Icon icon={meta.icon} size={14} />
          {meta.label}
        </span>
        <span className="text-[var(--ink-muted)] font-mono text-[10px]">{refs.length}</span>
      </div>
      {refs.length === 0 ? (
        <div className="p-2.5 px-3 text-[var(--ink-muted)] font-mono text-[10px]">{meta.hint} — none</div>
      ) : (
        <div className="p-1 flex flex-col gap-0.5">
          {refs.map((r) => (
            <RefRow key={r.nodeId} r={r} color={meta.color} onSelect={onSelect} />
          ))}
        </div>
      )}
    </AstryxCard>
  );
}

export function IntelligencePanel({ graph, selectedId, onSelect, insights = [], insightsLoading = false }: IntelligencePanelProps) {
  const selectedNode = useMemo(() => graph.nodes.find((n) => n.id === selectedId) || null, [graph.nodes, selectedId]);
  const intel = useMemo(() => (selectedId ? nodeIntelligence(graph, selectedId) : null), [graph, selectedId]);
  const rootNode = useMemo(() => graph.nodes.find((n) => n.id === graph.rootId) || null, [graph.nodes, graph.rootId]);

  if (!selectedNode || !intel) {
    return (
      <div className="flex flex-col gap-3">
        <MonoLabel index="//">graph intelligence</MonoLabel>
        {rootNode && (
          <AstryxCard variant="transparent" padding={0} className="border border-[var(--line)] rounded-xl p-3 bg-[var(--accent-a06)]">
            <div className="flex items-center gap-1.75 text-[var(--accent-ink)] font-mono text-xs tracking-tight uppercase">
              <Icon icon="solar:crown-minimalistic-linear" size={14} />
              Foundational dimension
            </div>
            <button
              onClick={() => onSelect(rootNode.id)}
              className="mt-2 bg-transparent border-none text-[var(--ink)] text-sm font-semibold cursor-pointer p-0 text-left hover:text-[var(--accent)] transition-colors"
            >
              {String(rootNode.dimension).padStart(2, '0')} · {rootNode.label}
            </button>
            <p className="mt-1.5 text-[var(--ink-muted)] text-xs leading-relaxed">
              The most connected node — the conceptual anchor the rest of the analysis leans on.
            </p>
          </AstryxCard>
        )}
        <div className="text-[var(--ink-muted)] font-mono text-xs leading-relaxed">
          Select a node to see its <span className="text-[var(--accent-ink)]">related</span>,{' '}
          <span className="text-[var(--accent-ink)]">similar</span>, <span className="text-[var(--ink-secondary)]">tangent</span> and{' '}
          <span className="text-[var(--warn)]">contrarian</span> connections.
        </div>
        <StanceSection insights={insights} loading={insightsLoading} selectedDim={null} onSelect={onSelect} />
        <div className="border-t border-[var(--line)] pt-2.5 flex flex-wrap gap-2.5 text-[var(--ink-muted)] font-mono text-[10px] tracking-tight">
          <span>{graph.nodes.length} nodes</span>
          <span>·</span>
          <span>{graph.edges.length} relations</span>
          <span>·</span>
          <span>green rim = positive · red rim = critical</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[var(--ink-muted)] font-mono text-xs tracking-tight">
            DIMENSION {String(selectedNode.dimension).padStart(2, '0')}
            {intel.isFoundational && <span className="text-[var(--accent-ink)] ml-2">● foundational</span>}
          </div>
          <div className="text-[var(--ink)] text-sm font-semibold mt-0.5 tracking-tight">{selectedNode.label}</div>
        </div>
        <Tooltip content="Clear selection">
          <button
            onClick={() => onSelect(null)}
            className="flex-shrink-0 w-[26px] h-[26px] rounded-lg border border-[var(--line)] bg-transparent text-[var(--ink-muted)] cursor-pointer hover:text-[var(--ink)] transition-colors"
          >
            <Icon icon="solar:close-circle-linear" size={14} />
          </button>
        </Tooltip>
      </div>

      {selectedNode.keyTerms.length > 0 && (
        <div className="flex flex-wrap gap-1.25">
          {selectedNode.keyTerms.map((t) => (
            <span key={t} className="p-0.5 px-2 rounded-lg border border-[var(--line)] text-[var(--ink-secondary)] font-mono text-[10px] tracking-tight">
              {t}
            </span>
          ))}
        </div>
      )}

      <RelationCard kind="related" refs={intel.related} onSelect={onSelect} />
      <RelationCard kind="similar" refs={intel.similar} onSelect={onSelect} />
      <RelationCard kind="contrarian" refs={intel.contrarian} onSelect={onSelect} />
      <RelationCard kind="tangents" refs={intel.tangents} onSelect={onSelect} />
      <StanceSection insights={insights} loading={insightsLoading} selectedDim={selectedNode.dimension} onSelect={onSelect} />
    </div>
  );
}
