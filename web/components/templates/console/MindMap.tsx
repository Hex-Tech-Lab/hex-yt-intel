'use client';

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Tooltip } from '@astryxdesign/core';
import { entityHex, entityRgb } from '@/lib/design/entity-colors';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';
import { Icon } from '@/components/templates/_shared/primitives';

interface MindMapProps {
  graph: KnowledgeGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface MindNode {
  id: string;
  label: string;
  type: string;
  weight: number;
  parentId: string | null;
  children: MindNode[];
}

export function MindMap({ graph, selectedId, onSelect }: MindMapProps) {
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // Pan & Zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const dragMovedRef = useRef(false);

  // Reset layout position, zoom level, and collapsed node state whenever a new graph/video is loaded or restored from history
  // Deliberately keyed on rootId alone, not graph.nodes -- nodes is a
  // mutable array that grows on every incremental KG fragment during live
  // synthesis (confirmed: ~35 separate node/edge-count updates in one
  // analysis), so including it would reset pan/zoom/state on every single
  // node arriving, not just on an actual video switch. rootId is set once
  // from the first KG fragment and stays stable for the rest of that video.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCollapsedNodes({});
  }, [graph?.rootId]);

  // Hierarchy score: lower is higher in the tree (Theme -> Concept -> Implementation -> Detail)
  const typePriority = useMemo((): Record<string, number> => ({
    trend: 0,        // Theme level
    study: 0,        // Theme level
    person: 1,       // Concept level
    concept: 2,      // Implementation level
    organization: 3, // Detail level
    framework: 4,    // Detail level
    tool: 5,         // Detail level
    metric: 6        // Detail level
  }), []);

  const toggleCollapse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // 1. Build tree structure from graph
  const treeData = useMemo(() => {
    if (!graph.nodes || graph.nodes.length === 0) return null;

    // Derive root by weight or rootId
    let rootNode = graph.nodes.find((n) => n.id === graph.rootId);
    if (!rootNode) {
      rootNode = graph.nodes.reduce((max, node) => (node.weight > max.weight ? node : max), graph.nodes[0]!);
    }

    const nodeMap: Record<string, MindNode> = {};
    graph.nodes.forEach((n) => {
      nodeMap[n.id] = {
        id: n.id,
        label: n.label,
        type: n.entityType || 'concept',
        weight: n.weight || 1,
        parentId: null,
        children: [],
      };
    });

    // Determine edges/connections. Map parent-child based on edges with hierarchy logic
    const visited = new Set<string>([rootNode.id]);
    const queue = [rootNode.id];

    while (queue.length > 0) {
      // Sort queue by priority to process "Themes" first and build depth
      queue.sort((a, b) => (typePriority[nodeMap[a]!.type] ?? 99) - (typePriority[nodeMap[b]!.type] ?? 99));
      const currentId = queue.shift()!;
      const parentNode = nodeMap[currentId]!;

      // Find neighbors
      const neighbors: string[] = [];
      for (const edgeItem of graph.edges) {
        if (edgeItem.source === currentId || edgeItem.target === currentId) {
          const neighborId = edgeItem.source === currentId ? edgeItem.target : edgeItem.source;
          if (!visited.has(neighborId) && nodeMap[neighborId]) {
            neighbors.push(neighborId);
          }
        }
      }

      neighbors.forEach((neighborId) => {
        const neighborNode = nodeMap[neighborId];
        if (!neighborNode || !parentNode) return;
        visited.add(neighborId);
        neighborNode.parentId = currentId;
        if (!parentNode.children) parentNode.children = [];
        parentNode.children.push(neighborNode);
        queue.push(neighborId);
      });
    }

    // Capture isolated/disconnected nodes and slot them into the hierarchy
    const rootMindNode = nodeMap[rootNode.id];
    graph.nodes.forEach((n) => {
      const mindNode = nodeMap[n.id];
      if (!mindNode || visited.has(n.id) || n.id === rootNode.id) return;
      const myTypePri = typePriority[mindNode.type] ?? 99;
      // Find a visited node with lower priority (higher in tree)
      const candidates: MindNode[] = [];
      for (const vCandidate of Object.values(nodeMap)) {
        if (visited.has(vCandidate.id) && (typePriority[vCandidate.type] ?? 99) < myTypePri) {
          candidates.push(vCandidate);
        }
      }
      const bestParent = candidates.length > 0
        ? candidates.sort((a, b) => b.weight - a.weight)[0]
        : rootMindNode;
      if (bestParent) {
        mindNode.parentId = bestParent.id;
        if (!bestParent.children) bestParent.children = [];
        bestParent.children.push(mindNode);
        visited.add(n.id);
      }
    });

    return rootMindNode!;
  }, [graph, typePriority]);

  // Compute positions for SVG rendering
  const layout = useMemo(() => {
    if (!treeData) return null;

    const nodesList: { node: MindNode; x: number; y: number; level: number }[] = [];
    const linksList: { sourceX: number; sourceY: number; targetX: number; targetY: number; targetId: string }[] = [];

    const colWidth = 190;
    const rowHeight = 48;
    const nodeWidth = 160;
    const nodeHeight = 32; // Consistent with py-2 (8px) + content (~16px)

    const countVisibleLeaves = (node: MindNode): number => {
      if (collapsedNodes[node.id] || node.children.length === 0) return 1;
      return node.children.reduce((acc, child) => acc + countVisibleLeaves(child), 0);
    };

    const traverse = (node: MindNode, level: number, startY: number): number => {
      const totalLeaves = countVisibleLeaves(node);
      const x = 20 + level * colWidth;
      const y = startY + (totalLeaves * rowHeight) / 2 - rowHeight / 2;

      nodesList.push({ node, x, y, level });

      if (!collapsedNodes[node.id]) {
        let currentY = startY;
        // Sort children by priority for consistent vertical layout
        const sortedChildren = [...node.children].sort((a, b) => (typePriority[a.type] ?? 99) - (typePriority[b.type] ?? 99));

        sortedChildren.forEach((child) => {
          const childLeaves = countVisibleLeaves(child);
          const childY = currentY + (childLeaves * rowHeight) / 2 - rowHeight / 2;
          const childX = 20 + (level + 1) * colWidth;

          linksList.push({
            sourceX: x + nodeWidth, // right edge of parent node boundary
            sourceY: y + nodeHeight / 2,  // true vertical center of parent node
            targetX: childX, // left edge of child node boundary
            targetY: childY + nodeHeight / 2,  // true vertical center of child node
            targetId: child.id,
          });

          traverse(child, level + 1, currentY);
          currentY += childLeaves * rowHeight;
        });
      }

      return totalLeaves;
    };

    traverse(treeData, 0, 20);

    // Dynamic width & height calculation
    const maxX = Math.max(...nodesList.map((n) => n.x)) + colWidth + 50;
    const maxY = Math.max(...nodesList.map((n) => n.y)) + 60;

    return { nodes: nodesList, links: linksList, w: maxX, h: Math.max(300, maxY) };
  }, [treeData, collapsedNodes, typePriority]);

  // Fit to view calculation for currently visible (expanded) nodes
  const fitToView = useCallback(() => {
    if (!layout || !layout.nodes || layout.nodes.length === 0 || !containerRef.current) return;
    const container = containerRef.current;
    const containerW = container.clientWidth || 600;
    const containerH = container.clientHeight || 420;

    const minX = Math.min(...layout.nodes.map((n) => n.x));
    const maxX = Math.max(...layout.nodes.map((n) => n.x + 160));
    const minY = Math.min(...layout.nodes.map((n) => n.y));
    const maxY = Math.max(...layout.nodes.map((n) => n.y + 32));

    const boundsW = Math.max(1, maxX - minX);
    const boundsH = Math.max(1, maxY - minY);

    const padding = 32;
    const availableW = Math.max(100, containerW - padding * 2);
    const availableH = Math.max(100, containerH - padding * 2);

    const scaleX = availableW / boundsW;
    const scaleY = availableH / boundsH;
    const targetZoom = Math.min(2.5, Math.max(0.4, Math.min(scaleX, scaleY)));

    const targetPanX = containerW / 2 - (minX + boundsW / 2) * targetZoom;
    const targetPanY = containerH / 2 - (minY + boundsH / 2) * targetZoom;

    setZoom(targetZoom);
    setPan({ x: targetPanX, y: targetPanY });
  }, [layout]);

  // Run fitToView once on initial render only. `fitToView` is recreated
  // whenever `layout` changes (which happens on every collapse/expand), and
  // firing it on every layout change would silently discard the user's own
  // pan/zoom every time they toggle a node -- the fit-to-view control exists
  // precisely so the user opts into that, not so it happens implicitly.
  const hasFitOnceRef = useRef(false);
  useEffect(() => {
    if (hasFitOnceRef.current) return;
    if (!layout || !layout.nodes || layout.nodes.length === 0) return;
    hasFitOnceRef.current = true;
    fitToView();
  }, [fitToView, layout]);

  // Handle non-passive wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 0.85;

      setZoom((prevZoom) => {
        const newZoom = Math.min(3, Math.max(0.3, prevZoom * factor));
        const actualFactor = newZoom / prevZoom;
        setPan((prevPan) => ({
          x: mouseX - (mouseX - prevPan.x) * actualFactor,
          y: mouseY - (mouseY - prevPan.y) * actualFactor,
        }));
        return newZoom;
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Global mousemove/mouseup listeners while dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.hypot(dx, dy) > 4) {
        dragMovedRef.current = true;
      }
      setPan({
        x: panStartRef.current.x + dx,
        y: panStartRef.current.y + dy,
      });
    };

    const handleWindowMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragMovedRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
    setIsDragging(true);
  };

  const handleNodeClick = (nodeId: string) => {
    if (dragMovedRef.current) return;
    onSelect(nodeId === selectedId ? null : nodeId);
  };

  if (!layout) {
    return <div className="p-4 text-center text-[var(--ink-muted)]">No mind map data</div>;
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      className={`relative w-full overflow-hidden border border-[var(--line-faint)] bg-[radial-gradient(circle_at_50%_40%,_rgb(15_23_42_/_0.2),_rgb(8_11_17_/_0.6))] rounded-lg js-mind-map-container select-none ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{ height: '420px', maxHeight: '420px', padding: '8px' }}
    >
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          width: layout.w,
          height: layout.h,
          position: 'relative',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
        }}
        className="relative"
      >
        <svg
          width={layout.w}
          height={layout.h}
          className="absolute pointer-events-none"
          style={{ top: 0, left: 0 }}
        >
          {layout.links.map((link) => {
            const midX = (link.sourceX + link.targetX) / 2;
            const path = `M ${link.sourceX} ${link.sourceY} C ${midX} ${link.sourceY}, ${midX} ${link.targetY}, ${link.targetX} ${link.targetY}`;
            return (
              <path
                key={`${link.sourceX}-${link.sourceY}-${link.targetX}-${link.targetY}`}
                d={path}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.5}
                strokeOpacity={0.15}
              />
            );
          })}
        </svg>

        <div style={{ width: layout.w, height: layout.h, position: 'relative' }} className="relative">
          {layout.nodes.map(({ node, x, y }) => {
            const isSelected = selectedId === node.id;
            const isCollapsed = collapsedNodes[node.id];
            const hasChildren = node.children.length > 0;
            const typeRgb = entityRgb(node.type);

            return (
              <div
                key={node.id}
                onClick={() => handleNodeClick(node.id)}
                style={{
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: 160,
                  cursor: 'pointer',
                  zIndex: isSelected ? 20 : 10,
                  color: entityHex(node.type),
                  background: `rgb(${typeRgb} / 0.12)`,
                  borderColor: isSelected ? 'var(--accent)' : `rgb(${typeRgb} / 0.5)`,
                }}
                className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[10.5px] font-sans leading-tight transition-all duration-200 ${
                  isSelected ? 'ring-2 ring-[var(--accent)] scale-[1.03] shadow-lg shadow-[var(--accent-glow)]' : 'hover:scale-[1.02]'
                }`}
              >
                <div className="flex flex-col truncate pr-1">
                  <Tooltip content={node.label}>
                    <span className="truncate font-bold">
                      {node.label}
                    </span>
                  </Tooltip>
                  <span className="text-[8px] opacity-60 uppercase tracking-widest font-mono">
                    {node.type}
                  </span>
                </div>
                {hasChildren && (
                  <button
                    onClick={(e) => toggleCollapse(node.id, e)}
                    className="flex-shrink-0 ml-1 hover:text-[var(--accent)] border-none bg-transparent cursor-pointer p-0 flex items-center justify-center"
                  >
                    <Icon 
                      icon={isCollapsed ? 'solar:add-square-linear' : 'solar:minimize-square-linear'} 
                      size={14} 
                      style={{ color: isCollapsed ? 'var(--accent)' : 'inherit' }}
                    />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Fit-to-view control */}
      <Tooltip content="Fit to view">
        <button
          onClick={fitToView}
          type="button"
          aria-label="Fit to view"
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            width: 28,
            height: 28,
            borderRadius: 4,
            border: '1px solid var(--line)',
            background: 'rgb(26 31 43 / 0.8)',
            color: 'var(--ink-secondary)',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            zIndex: 30,
          }}
          className="hover:text-[var(--ink)] hover:bg-[rgb(30,41,59,0.9)] transition-colors"
        >
          <Icon icon="solar:maximize-square-linear" size={14} />
        </button>
      </Tooltip>
    </div>
  );
}

