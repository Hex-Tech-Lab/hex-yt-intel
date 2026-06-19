'use client';

import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import dynamic from 'next/dynamic';
import { forceCollide, forceCenter, forceManyBody } from 'd3-force';
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

// Colored rings colors by entityType
const TYPE_COLOR: Record<string, string> = {
  person: '244 63 94',       // rose
  concept: '168 85 247',     // purple
  framework: '234 179 8',    // yellow
  tool: '6 182 212',         // cyan
  organization: '59 130 246', // blue
  study: '16 185 129',       // emerald
  trend: '249 115 22',       // orange
  metric: '236 72 153',      // pink
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
  const hoverIdRef = useRef<string | null>(null);

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

  // Configure custom D3 forces on the engine to resolve isolated islands
  useEffect(() => {
    if (fgRef.current) {
      // 1. Repulsion force
      fgRef.current.d3Force('charge', forceManyBody().strength(compact ? -60 : -140));

      // 2. Center gravity force (Black hole centering pulling disconnected nodes)
      fgRef.current.d3Force('center', forceCenter(size.w / 2, size.h / 2));

      // 3. Collision force to prevent overlapping nodes
      fgRef.current.d3Force(
        'collide',
        forceCollide().radius((node: any) => {
          const r = (compact ? 3 : 4) + (node.weight || 0) * (compact ? 3.5 : 5);
          return r + (compact ? 4 : 8);
        })
      );
    }
  }, [size, compact, data]);

  // Neighborhood of the selected node — drives highlight/dim on selection.
  // Hover dimming is handled imperatively via the force-graph's own repaint cycle.
  const neighborhood = useMemo(() => {
    if (!selectedId) return null;
    const nodes = new Set<string>([selectedId]);
    const links = new Set<string>();
    graph.edges.forEach((e, i) => {
      if (e.source === selectedId || e.target === selectedId) {
        nodes.add(e.source);
        nodes.add(e.target);
        links.add(`${i}`);
      }
    });
    return { nodes, links };
  }, [selectedId, graph.edges]);

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
      hoverIdRef.current = id;
      onHover?.(id);
      if (containerRef.current) containerRef.current.style.cursor = id ? 'pointer' : 'grab';
    },
    [onHover]
  );

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (
    <div
      ref={containerRef}
      className="js-knowledge-graph-container"
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
        warmupTicks={50}
        cooldownTicks={compact ? 120 : 300}
        onEngineStop={fit}
        nodeRelSize={compact ? 3 : 5}
        nodeVal={(n: any) => 1 + (n as FGNode).weight * 3}
        nodeLabel={() => ''}
        enableNodeDrag={true}
        onNodeClick={(n: any) => startTransition(() => onSelect((n as FGNode).id === selectedId ? null : (n as FGNode).id))}
        onNodeRightClick={(n: any, e: MouseEvent) => {
          e.preventDefault();
          const node = n as FGNode;
          node.fx = node.x;
          node.fy = node.y;
          onFocus?.(node.id);
          startTransition(() => onSelect(node.id));
          try {
            fgRef.current?.centerAt(node.x, node.y, 600);
            fgRef.current?.zoom(compact ? 2.2 : 2.6, 600);
          } catch {
            /* noop */
          }
        }}
        onNodeHover={handleHover as any}
        onBackgroundClick={() => startTransition(() => onSelect(null))}
        linkColor={(l: any) => {
          const idx = data.links.indexOf(l);
          const dim = neighborhood ? !neighborhood.links.has(`${idx}`) : false;
          const base = KIND_COLOR[l.kind as RelationKind] || COL.slate;
          return `rgb(${base} / ${dim ? 0.05 : 0.3 + l.strength * 0.35})`;
        }}
        linkWidth={(l: any) => {
          const idx = data.links.indexOf(l);
          const active = neighborhood ? neighborhood.links.has(`${idx}`) : false;
          return (active ? 1.8 : 0.5) + l.strength * 0.8;
        }}
        linkLineDash={(l: any) => (l.kind === 'contrarian' ? [4, 3] : null)}
        nodeCanvasObject={(n: any, ctx: CanvasRenderingContext2D, scale: number) => {
          const node = n as FGNode;
          const hoverActive = hoverIdRef.current;
          const dim = neighborhood ? !neighborhood.nodes.has(node.id) : (hoverActive ? node.id !== hoverActive && node.id !== selectedId : false);
          const isRoot = graph.rootId === node.id;
          const isActive = node.id === selectedId || node.id === hoverActive;
          const r = (compact ? 3.5 : 5) + node.weight * (compact ? 2.5 : 4);

          // Draw base backing container (slate/dark theme)
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
          ctx.fillStyle = dim ? 'rgba(30, 41, 59, 0.2)' : 'rgba(15, 23, 42, 0.9)';
          ctx.fill();

          // Colored border/ring based on entity type!
          const typeRgb = TYPE_COLOR[node.entityType || ''] || COL.slate;
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
          ctx.lineWidth = (isActive || node.id === selectedId ? 2.5 : 1.25) / scale;
          ctx.strokeStyle = dim ? `rgb(${COL.slate} / 0.15)` : `rgb(${typeRgb} / ${node.inPersona || isRoot ? '0.95' : '0.6'})`;
          ctx.stroke();

          // Active/selected double ring
          if (isActive || node.id === selectedId) {
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, r + 3 / scale, 0, 2 * Math.PI);
            ctx.lineWidth = 1 / scale;
            ctx.strokeStyle = `rgb(${COL.accent} / 0.8)`;
            ctx.stroke();
          }

          // Root halo ring
          if (isRoot && !dim) {
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, r + 6 / scale, 0, 2 * Math.PI);
            ctx.lineWidth = 1 / scale;
            ctx.strokeStyle = `rgb(${COL.accent} / 0.3)`;
            ctx.stroke();
          }

          const showLabel = isActive || node.id === selectedId || node.weight >= 2 || scale > (compact ? 1.2 : 0.8);
          if (showLabel && !dim) {
            const baseFontSize = compact ? 9 : 10;
            const clampedFontSize = Math.max(7.5, baseFontSize / scale);
            ctx.font = `500 ${clampedFontSize}px Inter, system-ui, -apple-system, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = `rgb(${COL.ink} / ${isActive ? 1 : 0.8})`;

            const label = node.label;
            const maxWidth = (compact ? 60 : 80) / scale;
            const lineHeight = (compact ? 10 : 12) / scale;
            
            // Simple text wrapping
            const words = label.split(' ');
            let line = '';
            const lines = [];
            
            for (let n = 0; n < words.length; n++) {
              const testLine = line + words[n] + ' ';
              const metrics = ctx.measureText(testLine);
              if (metrics.width > maxWidth && line !== '') {
                lines.push(line.trim());
                line = words[n] + ' ';
              } else {
                line = testLine;
              }
            }
            lines.push(line.trim());

            const startY = node.y! + r + 4 / scale;
            lines.forEach((l, i) => {
              ctx.fillText(l, node.x!, startY + i * lineHeight);
            });
          }
        }}
        nodePointerAreaPaint={(n: any, color: string, ctx: CanvasRenderingContext2D) => {
          const node = n as FGNode;
          const r = (compact ? 3.5 : 5) + node.weight * (compact ? 2.5 : 4) + 4;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
          ctx.fill();
        }}
      />

      {/* Floating Legend */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid var(--line)',
        padding: '8px 10px',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        pointerEvents: 'none',
        zIndex: 10,
        fontFamily: 'var(--font-mono)',
        fontSize: compact ? 9 : 10,
      }}>
        {Object.entries(TYPE_COLOR).map(([type, colorRgb]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: `rgb(${colorRgb})`,
              boxShadow: `0 0 8px rgb(${colorRgb})`
            }} />
            <span style={{ color: 'var(--ink-secondary)', textTransform: 'capitalize' }}>{type}</span>
          </div>
        ))}
      </div>

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
          zIndex: 10
        }}
      >
        ⤢
      </button>
    </div>
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
