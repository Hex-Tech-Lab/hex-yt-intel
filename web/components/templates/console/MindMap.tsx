'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';
import { entityHex, entityRgb } from '@/lib/design/entity-colors';

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
      const neighbors = graph.edges
        .filter((e) => e.source === currentId || e.target === currentId)
        .map((e) => (e.source === currentId ? e.target : e.source))
        // Only take neighbors that are "lower" in priority or equal if not visited
        .filter(id => !visited.has(id) && nodeMap[id]);

      neighbors.forEach((neighborId) => {
        visited.add(neighborId);
        nodeMap[neighborId]!.parentId = currentId;
        parentNode.children.push(nodeMap[neighborId]!);
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
      const candidates = Object.values(nodeMap).filter(
        v => visited.has(v.id) && (typePriority[v.type] ?? 99) < myTypePri
      );
      const bestParent = candidates.length > 0
        ? candidates.sort((a, b) => b.weight - a.weight)[0]
        : rootMindNode;
      if (bestParent) {
        mindNode.parentId = bestParent.id;
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
            sourceX: x + nodeWidth, // right edge of parent node
            sourceY: y + 16,  // center vertical
            targetX: childX, // left edge of child node
            targetY: childY + 16,
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

  if (!layout) {
    return <div className="p-4 text-center text-[var(--ink-muted)]">No mind map data.</div>;
  }

  return (
    <div 
      className="relative w-full overflow-auto hx-custom-scrollbar border border-[var(--line-faint)] bg-[radial-gradient(circle_at_50%_40%,_rgb(15_23_42_/_0.2),_rgb(8_11_17_/_0.6))] rounded-lg p-4 js-mind-map-container"
      style={{ maxHeight: '420px' }}
    >
      <svg 
        width={layout.w} 
        height={layout.h} 
        className="absolute inset-0 pointer-events-none"
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

      <div style={{ width: layout.w, height: layout.h, position: 'relative' }}>
        {layout.nodes.map(({ node, x, y }) => {
          const isSelected = selectedId === node.id;
          const isCollapsed = collapsedNodes[node.id];
          const hasChildren = node.children.length > 0;
          const typeRgb = entityRgb(node.type);

          return (
            <div
              key={node.id}
              onClick={() => onSelect(node.id === selectedId ? null : node.id)}
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
                <span className="truncate font-bold" title={node.label}>
                  {node.label}
                </span>
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
  );
}

