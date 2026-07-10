'use client';

import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import dynamic from 'next/dynamic';
import { forceCollide, forceCenter, forceManyBody } from 'd3-force';
import type { KnowledgeGraph, RelationKind } from '@/lib/types/knowledge-graph';
import { ENTITY_RGB, entityRgb } from '@/lib/design/entity-colors';

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

  // Map domain graph → force-graph shape. Create stable identity keyed by actual node/edge content,
  // not graph reference, to prevent physics engine restart during dimension building.
  // This allows smooth animation with 1-2 second intervals as dimensions accumulate.
  const dataKey = useMemo(
    () => {
      const nodeIds = graph.nodes.map((n) => n.id).join('|');
      const edgeIds = graph.edges.map((e) => `${e.source}-${e.target}`).join('|');
      return `${nodeIds}:${edgeIds}`;
    },
    [graph.nodes, graph.edges]
  );

  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })) as FGNode[],
      links: graph.edges.map((e) => ({ source: e.source, target: e.target, strength: e.strength, kind: e.kind })),
    }),
    [dataKey]
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
    } catch (e) {
      console.debug('[KnowledgeGraphCanvas] zoomToFit skipped (ref not ready):', e);
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
        borderRadius: 8,
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
        enableNodeDrag
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
          } catch (e) {
            console.debug('[KnowledgeGraphCanvas] centerAt/zoom animation skipped:', e);
          }
        }}
        onNodeHover={handleHover as any}
        onBackgroundClick={() => startTransition(() => onSelect(null))}
        linkColor={(l: any) => {
          const idx = data.links.indexOf(l);
          const dim = neighborhood ? !neighborhood.links.has(`${idx}`) : false;
          const base = KIND_COLOR[l.kind as RelationKind] || COL.slate;
          return `rgb(${base} / ${dim ? 0.03 : 0.12 + l.strength * 0.18})`;
        }}
        linkWidth={(l: any) => {
          const idx = data.links.indexOf(l);
          const active = neighborhood ? neighborhood.links.has(`${idx}`) : false;
          return active ? 1.5 : 0.4 + l.strength * 0.4;
        }}
        linkLineDash={(l: any) => (l.kind === 'contrarian' ? [4, 3] : null)}
        nodeCanvasObject={(n: any, ctx: CanvasRenderingContext2D, scale: number) => {
          const node = n as FGNode;
          const hoverActive = hoverIdRef.current;
          const dim = neighborhood ? !neighborhood.nodes.has(node.id) : (hoverActive ? node.id !== hoverActive && node.id !== selectedId : false);
          const isRoot = graph.rootId === node.id;
          const isActive = node.id === selectedId || node.id === hoverActive;
          const r = (compact ? 3.5 : 5) + node.weight * (compact ? 2.5 : 4);
          // entityRgb already defaults to ENTITY_DEFAULT_RGB for missing/unknown
          // types, so there's no separate "unknown" colour to keep in sync here.
          const typeRgb = entityRgb(node.entityType);

          // Draw base backing container filled with node category color (glowing fill)
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
          ctx.fillStyle = dim 
            ? 'rgba(30, 41, 59, 0.1)' 
            : `rgb(${typeRgb} / ${isActive ? '0.85' : (isRoot ? '0.6' : '0.3')})`;
          ctx.fill();

          // Colored border/ring based on entity type!
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
          ctx.lineWidth = (isActive || node.id === selectedId ? 2.5 : 1.25) / scale;
          ctx.strokeStyle = dim ? `rgb(${COL.slate} / 0.1)` : `rgb(${typeRgb} / ${node.inPersona || isRoot || isActive ? '1.0' : '0.7'})`;
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

          // Check if node is a neighbor of the hover or active node
          const isNeighbor = neighborhood?.nodes.has(node.id) || (hoverActive && data.links.some(l => {
            const sId = typeof l.source === 'object' ? (l.source as any).id : l.source;
            const tId = typeof l.target === 'object' ? (l.target as any).id : l.target;
            return (sId === node.id && tId === hoverActive) || (tId === node.id && sId === hoverActive);
          }));

          // Show labels for selected/hovered/neighbor nodes and any meaningful node,
          // plus everything once the user zooms in. Meaningful nodes stay labelled at
          // default zoom so the graph isn't a blank dot-cloud.
          const showLabel = isActive || isNeighbor || node.weight >= 1.5 || scale > (compact ? 1.2 : 0.8);

          if (showLabel && !dim) {
            // Font size scales with node weight (frequency): 11px-26px range
            // Normalize weight to 0-1 range (assume max weight ~10 for common distributions)
            const minFontSize = 11;
            const maxFontSize = 26;
            const normalizedWeight = Math.min(1, Math.max(0, node.weight / 10));
            const weightedFontSize = minFontSize + (normalizedWeight * (maxFontSize - minFontSize));
            const clampedFontSize = Math.max(minFontSize * 0.6, Math.min(maxFontSize, weightedFontSize / Math.sqrt(scale)));

            // Font weight: bold (700) for selected nodes, regular (400) otherwise
            const fontWeight = node.id === selectedId ? 700 : 400;
            ctx.font = `${fontWeight} ${clampedFontSize}px Inter, system-ui, -apple-system, sans-serif`;
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
        {Object.entries(ENTITY_RGB).map(([type, colorRgb]) => (
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
