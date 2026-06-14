'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3-force';
import { useGlobalGraph } from '@/hooks/useGlobalGraph';

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
    
    // Use any casting for d3-force members to resolve type definition mismatches
    const d3Any = d3 as any;

    // Simulation
    const simulation = d3Any.forceSimulation(graph.nodes as any)
      .force('link', d3Any.forceLink(graph.edges).id((d: any) => d.label).distance(50))
      .force('charge', d3Any.forceManyBody().strength(-100))
      .force('center', d3Any.forceCenter(width / 2, height / 2))
      .force('collision', d3Any.forceCollide().radius((d: any) => (d.weight || 1) * 5 + 2));

    simulation.on('tick', () => {
      ctx.clearRect(0, 0, width, height);

      // Draw edges
      ctx.beginPath();
      ctx.strokeStyle = '#aaa';
      graph.edges.forEach((edge: any) => {
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);
      });
      ctx.stroke();

      // Draw nodes
      graph.nodes.forEach((node: any) => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, (node.weight || 1) * 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#00f';
        ctx.fill();
        ctx.stroke();
      });
    });

    return () => simulation.stop();
  }, [graph, loading, error]);

  if (loading) return <div>Loading Global Map...</div>;
  if (error) return <div>Error loading graph: {error}</div>;
  if (!graph || graph.nodes.length === 0) return <div>No history found.</div>;

  return <canvas ref={canvasRef} width={800} height={600} className="border border-gray-700" />;
}
