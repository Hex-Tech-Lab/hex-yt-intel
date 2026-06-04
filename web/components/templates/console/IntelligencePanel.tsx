'use client';

import { useMemo } from 'react';
import { MonoLabel, Icon } from '@/components/templates/_shared/primitives';
import { nodeIntelligence } from '@/lib/intelligence/knowledge-graph';
import type { KnowledgeGraph, RelatedRef, RelationInsight } from '@/lib/types/knowledge-graph';

export interface IntelligencePanelProps {
  graph: KnowledgeGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** LLM-derived stance relations (tangent/contrarian). Optional; shown when present. */
  insights?: RelationInsight[];
  /** True while the stance relations are being fetched. */
  insightsLoading?: boolean;
}

/** LLM stance insights — rationale-bearing tangent/contrarian cards. */
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--accent-ink)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        <Icon icon="solar:branching-paths-up-linear" size={14} />
        Stance intelligence
      </span>
      {loading ? (
        <div style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>analyzing tensions…</div>
      ) : (
        shown.map((i, idx) => {
          const contra = i.kind === 'contrarian';
          const color = contra ? 'var(--warn)' : 'var(--ink-secondary)';
          return (
            <div key={idx} style={{ border: '1px solid var(--line)', borderLeft: `2px solid ${color}`, borderRadius: 10, padding: '8px 11px', background: 'rgb(11 14 20 / 0.5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <Icon icon={contra ? 'solar:bolt-circle-linear' : 'solar:arrow-right-up-linear'} size={13} style={{ color }} />
                <span style={{ color, fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{i.kind}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                <button onClick={() => onSelect(`dim-${i.source}`)} style={{ background: 'transparent', border: 'none', color: 'var(--ink)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>{i.sourceLabel}</button>
                <Icon icon="solar:arrow-right-linear" size={12} style={{ color: 'var(--ink-muted)' }} />
                <button onClick={() => onSelect(`dim-${i.target}`)} style={{ background: 'transparent', border: 'none', color: 'var(--ink)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>{i.targetLabel}</button>
              </div>
              <p style={{ margin: 0, color: 'var(--ink-secondary)', fontSize: 11.5, lineHeight: 1.5 }}>{i.rationale}</p>
            </div>
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
    <span style={{ display: 'inline-block', width: 42, height: 4, borderRadius: 2, background: 'rgb(51 65 85 / 0.4)', overflow: 'hidden' }}>
      <span style={{ display: 'block', height: '100%', width: `${Math.round(Math.min(1, value) * 100)}%`, background: color }} />
    </span>
  );
}

function RefRow({ r, color, onSelect }: { r: RelatedRef; color: string; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(r.nodeId)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid transparent',
        background: 'transparent',
        color: 'var(--ink-secondary)',
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        textAlign: 'left',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgb(26 31 43 / 0.6)';
        e.currentTarget.style.borderColor = 'var(--line)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ color: 'var(--ink-muted)', fontSize: 10 }}>{String(r.dimension).padStart(2, '0')}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
      </span>
      <StrengthBar value={r.strength} color={color} />
    </button>
  );
}

function Card({
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
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: 'rgb(11 14 20 / 0.5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 11px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: meta.color, fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          <Icon icon={meta.icon} size={14} />
          {meta.label}
        </span>
        <span style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{refs.length}</span>
      </div>
      {refs.length === 0 ? (
        <div style={{ padding: '10px 11px', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{meta.hint} — none</div>
      ) : (
        <div style={{ padding: 5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {refs.map((r) => (
            <RefRow key={r.nodeId} r={r} color={meta.color} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

export function IntelligencePanel({ graph, selectedId, onSelect, insights = [], insightsLoading = false }: IntelligencePanelProps) {
  const selectedNode = useMemo(() => graph.nodes.find((n) => n.id === selectedId) || null, [graph.nodes, selectedId]);
  const intel = useMemo(() => (selectedId ? nodeIntelligence(graph, selectedId) : null), [graph, selectedId]);
  const rootNode = useMemo(() => graph.nodes.find((n) => n.id === graph.rootId) || null, [graph.nodes, graph.rootId]);

  // Overview when nothing is selected.
  if (!selectedNode || !intel) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <MonoLabel index="//">graph intelligence</MonoLabel>
        {rootNode && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, background: 'rgb(6 182 212 / 0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--accent-ink)', fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              <Icon icon="solar:crown-minimalistic-linear" size={14} />
              Foundational dimension
            </div>
            <button
              onClick={() => onSelect(rootNode.id)}
              style={{ marginTop: 8, background: 'transparent', border: 'none', color: 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0, textAlign: 'left' }}
            >
              {String(rootNode.dimension).padStart(2, '0')} · {rootNode.label}
            </button>
            <p style={{ marginTop: 6, color: 'var(--ink-muted)', fontSize: 11.5, lineHeight: 1.5 }}>
              The most connected node — the conceptual anchor the rest of the analysis leans on.
            </p>
          </div>
        )}
        <div style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.6 }}>
          Select a node to see its <span style={{ color: 'var(--accent-ink)' }}>related</span>,{' '}
          <span style={{ color: 'var(--accent-ink)' }}>similar</span>, <span style={{ color: 'var(--ink-secondary)' }}>tangent</span> and{' '}
          <span style={{ color: 'var(--warn)' }}>contrarian</span> connections.
        </div>
        <StanceSection insights={insights} loading={insightsLoading} selectedDim={null} onSelect={onSelect} />
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Selected node header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
            DIMENSION {String(selectedNode.dimension).padStart(2, '0')}
            {intel.isFoundational && <span style={{ color: 'var(--accent-ink)', marginLeft: 8 }}>● foundational</span>}
          </div>
          <div style={{ color: 'var(--ink)', fontSize: 16, fontWeight: 600, marginTop: 2 }}>{selectedNode.label}</div>
        </div>
        <button
          onClick={() => onSelect(null)}
          title="Clear selection"
          style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 7, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer' }}
        >
          <Icon icon="solar:close-circle-linear" size={14} />
        </button>
      </div>

      {/* Key terms */}
      {selectedNode.keyTerms.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {selectedNode.keyTerms.map((t) => (
            <span key={t} style={{ padding: '2px 8px', borderRadius: 9999, border: '1px solid var(--line)', color: 'var(--ink-secondary)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
              {t}
            </span>
          ))}
        </div>
      )}

      <Card kind="related" refs={intel.related} onSelect={onSelect} />
      <Card kind="similar" refs={intel.similar} onSelect={onSelect} />
      <Card kind="contrarian" refs={intel.contrarian} onSelect={onSelect} />
      <Card kind="tangents" refs={intel.tangents} onSelect={onSelect} />
      <StanceSection insights={insights} loading={insightsLoading} selectedDim={selectedNode.dimension} onSelect={onSelect} />
    </div>
  );
}
