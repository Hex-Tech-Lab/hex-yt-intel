'use client';

import { useEffect, useRef } from 'react';
import { 
  forceSimulation, 
  forceLink, 
  forceManyBody, 
  forceCenter, 
  forceCollide,
  SimulationNodeDatum,
  SimulationLinkDatum
} from 'd3-force';
import { useGlobalGraph } from '@/hooks/useGlobalGraph';
import { GraphNode } from '@/lib/types/knowledge-graph';

interface SimulationNode extends GraphNode, SimulationNodeDatum {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimulationLink extends SimulationLinkDatum<SimulationNode> {
  source: SimulationNode;
  target: SimulationNode;
  kind?: string;
  strength?: number;
}

export function GlobalKnowledgeMap() {
  const { graph, loading, error } = useGlobalGraph();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (loading || error || !graph || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Simulation
    const nodes: SimulationNode[] = graph.nodes.map(n => ({ ...n }));
    const edges = graph.edges.map(edge => ({ ...edge })) as unknown as SimulationLink[];

    const simulation = forceSimulation<SimulationNode, SimulationLink>(nodes)
      .force('link', forceLink<SimulationNode, SimulationLink>(edges).id((d: SimulationNode) => d.label).distance(50))
      .force('charge', forceManyBody<SimulationNode>().strength(-100))
      .force('center', forceCenter<SimulationNode>(width / 2, height / 2))
      .force('collision', forceCollide<SimulationNode>().radius((d: SimulationNode) => (d.weight || 1) * 5 + 2));

    simulation.on('tick', () => {
      ctx.clearRect(0, 0, width, height);

      // Draw edges
      ctx.beginPath();
      ctx.strokeStyle = '#aaa';
      edges.forEach((edge: SimulationLink) => {
        if (edge.source.x !== undefined && edge.source.y !== undefined && edge.target.x !== undefined && edge.target.y !== undefined) {
          ctx.moveTo(edge.source.x, edge.source.y);
          ctx.lineTo(edge.target.x, edge.target.y);
        }
      });
      ctx.stroke();

      // Draw nodes
      nodes.forEach((node: SimulationNode) => {
        if (node.x !== undefined && node.y !== undefined) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, (node.weight || 1) * 5, 0, 2 * Math.PI);
          ctx.fillStyle = '#00f';
          ctx.fill();
          ctx.stroke();
        }
      });
    });

    return () => {
      simulation.stop();
    };
  }, [graph, loading, error]);

  if (loading) return <div>Loading Global Map...</div>;
  if (error) return <div>Error loading graph: {error}</div>;
  if (!graph || graph.nodes.length === 0) return <div>No history found.</div>;

  return <canvas ref={canvasRef} width={800} height={600} className="border border-gray-700" />;
}
