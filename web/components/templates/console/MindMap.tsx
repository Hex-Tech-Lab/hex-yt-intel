'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';

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

    // Determine edges/connections. Map parent-child based on edges
    const visited = new Set<string>([rootNode.id]);
    const queue = [rootNode.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const parentNode = nodeMap[currentId]!;

      // Find neighbors
      const neighbors = graph.edges
        .filter((e) => e.source === currentId || e.target === currentId)
        .map((e) => (e.source === currentId ? e.target : e.source));

      neighbors.forEach((neighborId) => {
        if (!visited.has(neighborId) && nodeMap[neighborId]) {
          visited.add(neighborId);
          nodeMap[neighborId]!.parentId = currentId;
          parentNode.children.push(nodeMap[neighborId]!);
          queue.push(neighborId);
        }
      });
    }

    // Capture isolated/disconnected nodes and attach them to root as backup leaves
    graph.nodes.forEach((n) => {
      if (!visited.has(n.id) && nodeMap[n.id] && n.id !== rootNode!.id) {
        nodeMap[n.id]!.parentId = rootNode!.id;
        nodeMap[rootNode!.id]!.children.push(nodeMap[n.id]!);
        visited.add(n.id);
      }
    });

    return nodeMap[rootNode.id]!;
  }, [graph]);

  // Compute positions for SVG rendering
  const layout = useMemo(() => {
    if (!treeData) return null;

    const nodesList: { node: MindNode; x: number; y: number; level: number }[] = [];
    const linksList: { sourceX: number; sourceY: number; targetX: number; targetY: number; targetId: string }[] = [];

    const colWidth = 180;
    const rowHeight = 44;

    const countVisibleLeaves = (node: MindNode): number => {
      if (collapsedNodes[node.id] || node.children.length === 0) return 1;
      return node.children.reduce((acc, child) => acc + countVisibleLeaves(child), 0);
    };

    const traverse = (node: MindNode, level: number, startY: number): number => {
      const totalLeaves = countVisibleLeaves(node);
      const x = 30 + level * colWidth;
      const y = startY + (totalLeaves * rowHeight) / 2 - rowHeight / 2;

      nodesList.push({ node, x, y, level });

      if (!collapsedNodes[node.id]) {
        let currentY = startY;
        node.children.forEach((child) => {
          const childLeaves = countVisibleLeaves(child);
          const childY = currentY + (childLeaves * rowHeight) / 2 - rowHeight / 2;

          linksList.push({
            sourceX: x + 120, // offset right border of node container
            sourceY: y + 15,  // center vertical
            targetX: x + colWidth,
            targetY: childY + 15,
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
    const maxY = Math.max(...nodesList.map((n) => n.y)) + 50;

    return { nodes: nodesList, links: linksList, w: maxX, h: Math.max(260, maxY) };
  }, [treeData, collapsedNodes]);

  if (!layout) {
    return <div className="p-4 text-center text-[var(--ink-muted)]">No mind map data.</div>;
  }

  const colors: Record<string, string> = {
    person: 'border-rose-500 text-rose-400 bg-rose-950/20',
    concept: 'border-purple-500 text-purple-400 bg-purple-950/20',
    framework: 'border-yellow-500 text-yellow-400 bg-yellow-950/20',
    tool: 'border-cyan-500 text-cyan-400 bg-cyan-950/20',
    organization: 'border-blue-500 text-blue-400 bg-blue-950/20',
    study: 'border-emerald-500 text-emerald-400 bg-emerald-950/20',
    trend: 'border-orange-500 text-orange-400 bg-orange-950/20',
    metric: 'border-pink-500 text-pink-400 bg-pink-950/20',
  };

  return (
    <div 
      className="relative w-full overflow-auto hx-custom-scrollbar border border-[var(--line-faint)] bg-[radial-gradient(circle_at_50%_40%,_rgb(15_23_42_/_0.2),_rgb(8_11_17_/_0.6))] rounded-xl p-2"
      style={{ maxHeight: '350px' }}
    >
      <svg 
        width={layout.w} 
        height={layout.h} 
        className="absolute inset-0 pointer-events-none"
      >
        {layout.links.map((link, idx) => {
          // Draw a smooth bezier curve between nodes
          const midX = (link.sourceX + link.targetX) / 2;
          const path = `M ${link.sourceX} ${link.sourceY} C ${midX} ${link.sourceY}, ${midX} ${link.targetY}, ${link.targetX} ${link.targetY}`;
          return (
            <path
              key={idx}
              d={path}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.5}
              strokeOpacity={0.25}
            />
          );
        })}
      </svg>

      <div style={{ width: layout.w, height: layout.h, position: 'relative' }}>
        {layout.nodes.map(({ node, x, y }) => {
          const isSelected = selectedId === node.id;
          const isCollapsed = collapsedNodes[node.id];
          const hasChildren = node.children.length > 0;
          const typeStyle = colors[node.type] || 'border-[var(--line)] text-[var(--ink-secondary)] bg-[var(--surface-raised)]/40';

          return (
            <div
              key={node.id}
              onClick={() => onSelect(node.id === selectedId ? null : node.id)}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: 140,
                cursor: 'pointer',
                zIndex: isSelected ? 20 : 10,
              }}
              className={`flex items-center justify-between px-3 py-1.5 rounded-lg border text-[11px] font-mono leading-none transition-all duration-150 ${typeStyle} ${
                isSelected ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] scale-[1.03] shadow-md shadow-[var(--accent-glow)]' : 'hover:scale-[1.01] hover:border-[var(--ink-muted)]'
              }`}
            >
              <span className="truncate pr-1 font-bold" title={node.label}>
                {node.label}
              </span>
              {hasChildren && (
                <button
                  onClick={(e) => toggleCollapse(node.id, e)}
                  className="flex-shrink-0 ml-1 hover:text-[var(--accent)] border-none bg-transparent cursor-pointer p-0 flex items-center justify-center text-[10px]"
                >
                  <Icon 
                    icon={isCollapsed ? 'solar:add-square-linear' : 'solar:minimize-square-linear'} 
                    size={12} 
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
