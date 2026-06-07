'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { KnowledgeGraph, RelationKind } from '@/lib/types/knowledge-graph';

// react-force-graph-2d touches `window`, so it must be client-only.
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

// Theme tokens (matched to console CSS vars, hardcoded for canvas painting).
const COL = {
  accent: '6 182 212', // cyan
  ok: '34 197 94',
  warn: '245 158 11',
  err: '239 68 68',
  slate: '71 85 105',
  muted: '100 116 139',
  ink: '226 232 240',
};

const KIND_COLOR: Record<RelationKind, string> = {
  similar: COL.accent,
  related: COL.accent,
  tangent: COL.slate,
  contrarian: COL.warn,
};

export interface KnowledgeGraphCanvasProps {
  graph: KnowledgeGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  /** Pin/focus a node (right-click) — fixes it in place and re-centers. */
  onFocus?: (id: string) => void;
  height?: number;
  /** Compact mode for the rail (smaller labels, lighter physics). */
  compact?: boolean;
}

type FGNode = KnowledgeGraph['nodes'][number] & { x?: number; y?: number; fx?: number; fy?: number };

export function KnowledgeGraphCanvas({
  graph,
  selectedId,
  onSelect,
  onHover,
  onFocus,
  height,
  compact = false,
}: KnowledgeGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 600, h: height ?? (compact ? 280 : 520) });
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Measure container to size the canvas responsively.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: height ?? (compact ? 280 : el.clientHeight || 520) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height, compact]);

  // Map domain graph → force-graph shape. Stable identity per graph so physics settles.
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })) as FGNode[],
      links: graph.edges.map((e) => ({ source: e.source, target: e.target, strength: e.strength, kind: e.kind })),
    }),
    [graph]
  );

  // Neighborhood of the active (selected or hovered) node — drives highlight/dim.
  const activeId = hoverId || selectedId;
  const neighborhood = useMemo(() => {
    if (!activeId) return null;
    const nodes = new Set<string>([activeId]);
    const links = new Set<string>();
    graph.edges.forEach((e, i) => {
      if (e.source === activeId || e.target === activeId) {
        nodes.add(e.source);
        nodes.add(e.target);
        links.add(`${i}`);
      }
    });
    return { nodes, links };
  }, [activeId, graph.edges]);

  const fit = useCallback(() => {
    try {
      fgRef.current?.zoomToFit(400, compact ? 24 : 48);
    } catch {
      /* ref not ready */
    }
  }, [compact]);

  const handleHover = useCallback(
    (node: FGNode | null) => {
      const id = node?.id ?? null;
      setHoverId(id);
      onHover?.(id);
      if (containerRef.current) containerRef.current.style.cursor = id ? 'pointer' : 'grab';
    },
    [onHover]
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: height ?? (compact ? 280 : 520),
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid var(--line)',
        background: 'radial-gradient(circle at 50% 40%, rgb(15 23 42 / 0.6), rgb(8 11 17 / 0.95))',
      }}
    >
      <ForceGraph2D
        ref={fgRef as any}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={compact ? 60 : 120}
        onEngineStop={fit}
        nodeRelSize={compact ? 4 : 6}
        nodeVal={(n: any) => 1 + (n as FGNode).weight * 4}
        nodeLabel={() => ''}
        enableNodeDrag={true}
        onNodeClick={(n: any) => onSelect((n as FGNode).id === selectedId ? null : (n as FGNode).id)}
        onNodeRightClick={(n: any, e: MouseEvent) => {
          e.preventDefault();
          const node = n as FGNode;
          node.fx = node.x;
          node.fy = node.y;
          onFocus?.(node.id);
          onSelect(node.id);
          try {
            fgRef.current?.centerAt(node.x, node.y, 600);
            fgRef.current?.zoom(compact ? 2.2 : 2.6, 600);
          } catch {
            /* noop */
          }
        }}
        onNodeHover={handleHover as any}
        onBackgroundClick={() => onSelect(null)}
        linkColor={(l: any) => {
          const idx = data.links.indexOf(l);
          const dim = neighborhood ? !neighborhood.links.has(`${idx}`) : false;
          const base = KIND_COLOR[l.kind as RelationKind] || COL.slate;
          return `rgb(${base} / ${dim ? 0.06 : 0.35 + l.strength * 0.4})`;
        }}
        linkWidth={(l: any) => {
          const idx = data.links.indexOf(l);
          const active = neighborhood ? neighborhood.links.has(`${idx}`) : false;
          return (active ? 2.2 : 1) + l.strength * 2;
        }}
        linkLineDash={(l: any) => (l.kind === 'contrarian' ? [4, 3] : null)}
        nodeCanvasObject={(n: any, ctx: CanvasRenderingContext2D, scale: number) => {
          const node = n as FGNode;
          const dim = neighborhood ? !neighborhood.nodes.has(node.id) : false;
          const isRoot = graph.rootId === node.id;
          const isActive = node.id === activeId;
          const r = (compact ? 3 : 4) + node.weight * (compact ? 5 : 7);

          // Base fill: root = bright cyan, in-persona = cyan-ish, else slate.
          const fillRgb = isRoot ? COL.accent : node.inPersona ? COL.accent : COL.slate;
          const alpha = dim ? 0.22 : node.inPersona || isRoot ? 0.95 : 0.55;

          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
          ctx.fillStyle = `rgb(${fillRgb} / ${alpha})`;
          ctx.fill();

          // Polarity rim: green (positive) / red (negative).
          if (!dim && Math.abs(node.polarity) > 0.15) {
            ctx.lineWidth = 1.5 / scale;
            ctx.strokeStyle = `rgb(${node.polarity > 0 ? COL.ok : COL.err} / 0.9)`;
            ctx.stroke();
          }

          // Active/selected ring.
          if (isActive || node.id === selectedId) {
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, r + 3 / scale, 0, 2 * Math.PI);
            ctx.lineWidth = 1.5 / scale;
            ctx.strokeStyle = `rgb(${COL.accent} / 0.9)`;
            ctx.stroke();
          }

          // Root halo.
          if (isRoot && !dim) {
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, r + 6 / scale, 0, 2 * Math.PI);
            ctx.lineWidth = 1 / scale;
            ctx.strokeStyle = `rgb(${COL.accent} / 0.35)`;
            ctx.stroke();
          }

          // Label (only when zoomed in enough, or active, to avoid clutter).
          const showLabel = isActive || node.id === selectedId || scale > (compact ? 1.6 : 1.2);
          if (showLabel && !dim) {
            const fontSize = (compact ? 10 : 11) / scale;
            ctx.font = `${fontSize}px var(--font-mono, monospace)`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = `rgb(${COL.ink} / ${isActive ? 1 : 0.8})`;
            ctx.fillText(node.label, node.x!, node.y! + r + 2 / scale);
          }
        }}
        nodePointerAreaPaint={(n: any, color: string, ctx: CanvasRenderingContext2D) => {
          const node = n as FGNode;
          const r = (compact ? 3 : 4) + node.weight * (compact ? 5 : 7) + 4;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
          ctx.fill();
        }}
      />

      {/* Fit-to-view control */}
      <button
        onClick={fit}
        title="Fit to view"
        style={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          width: 30,
          height: 30,
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: 'rgb(26 31 43 / 0.8)',
          color: 'var(--ink-secondary)',
          cursor: 'pointer',
          fontSize: 14,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        ⤢
      </button>
    </div>
  );
}
