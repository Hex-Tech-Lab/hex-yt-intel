'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';

interface WordCloudProps {
  graph: KnowledgeGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface PlacedWord {
  id: string;
  label: string;
  type: string;
  weight: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  color: string;
}

const TYPE_COLORS: Record<string, string> = {
  person: '#f43f5e', // rose
  concept: '#a855f7', // purple
  framework: '#eab308', // yellow
  tool: '#06b6d4', // cyan
  organization: '#3b82f6', // blue
  study: '#10b981', // green
  trend: '#f97316', // orange
  metric: '#ec4899', // pink
};

export function WordCloud({ graph, selectedId, onSelect }: WordCloudProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 220 });
  const [hoveredWordId, setHoveredWordId] = useState<string | null>(null);

  // Resize handling
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: 220 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute collision-free layout
  const wordsLayout = useMemo(() => {
    if (!graph.nodes || graph.nodes.length === 0) return [];

    const nodes = graph.nodes
      .slice()
      .sort((a, b) => (b.weight || 0) - (a.weight || 0));

    const center = { x: size.w / 2, y: size.h / 2 };
    const placed: PlacedWord[] = [];

    // Auxiliary canvas for measuring text dimensions
    const testCanvas = document.createElement('canvas');
    const testCtx = testCanvas.getContext('2d');

    const checkOverlap = (a: PlacedWord, b: PlacedWord) => {
      // Add padding for collision check
      const padding = 6;
      return (
        Math.abs(a.x - b.x) * 2 < a.w + b.w + padding &&
        Math.abs(a.y - b.y) * 2 < a.h + b.h + padding
      );
    };

    nodes.forEach((node) => {
      const weight = node.weight || 1;
      const fontSize = Math.max(10, Math.min(26, 9 + weight * 2));
      const text = node.label;

      if (testCtx) {
        testCtx.font = `bold ${fontSize}px "Courier New", Courier, monospace`;
      }
      const textMetrics = testCtx ? testCtx.measureText(text) : { width: text.length * fontSize * 0.6 };
      const w = textMetrics.width;
      const h = fontSize;

      let placedWord: PlacedWord | null = null;
      let theta = Math.random() * Math.PI * 2;
      const step = 0.15;
      const spiralSpread = 2.4;
      let iterations = 0;

      // Archimedean spiral search for collision-free spot
      while (!placedWord && iterations < 350) {
        const distance = step * theta * spiralSpread;
        const x = center.x + distance * Math.cos(theta);
        const y = center.y + distance * Math.sin(theta) * 0.85; // slightly squished oval

        const candidate: PlacedWord = {
          id: node.id,
          label: text,
          type: node.entityType || 'concept',
          weight,
          x,
          y,
          w,
          h,
          fontSize,
          color: TYPE_COLORS[node.entityType || ''] || '#94a3b8',
        };

        // Check if overlaps with any already placed words
        const hasOverlap = placed.some((other) => checkOverlap(candidate, other));

        // Check canvas bounds
        const isOutOfBounds =
          x - w / 2 < 10 ||
          x + w / 2 > size.w - 10 ||
          y - h / 2 < 10 ||
          y + h / 2 > size.h - 10;

        if (!hasOverlap && !isOutOfBounds) {
          placedWord = candidate;
        }

        theta += step;
        iterations++;
      }

      // If we couldn't find a spot within bounds, place it anyway at backup coordinates
      if (!placedWord) {
        placedWord = {
          id: node.id,
          label: text,
          type: node.entityType || 'concept',
          weight,
          x: center.x + (Math.random() - 0.5) * 80,
          y: center.y + (Math.random() - 0.5) * 60,
          w,
          h,
          fontSize,
          color: TYPE_COLORS[node.entityType || ''] || '#94a3b8',
        };
      }

      placed.push(placedWord);
    });

    return placed;
  }, [graph.nodes, size.w, size.h]);

  // Handle canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, size.w, size.h);

    wordsLayout.forEach((word) => {
      const isSelected = selectedId === word.id;
      const isHovered = hoveredWordId === word.id;

      // Draw highlighting backing rect if active
      if (isSelected || isHovered) {
        ctx.fillStyle = isSelected ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.roundRect(
          word.x - word.w / 2 - 4,
          word.y - word.h / 2 - 2,
          word.w + 8,
          word.h + 4,
          4
        );
        ctx.fill();
        if (isSelected) {
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      ctx.fillStyle = word.color;
      ctx.font = `bold ${word.fontSize}px "Courier New", Courier, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(word.label, word.x, word.y);
    });
  }, [wordsLayout, selectedId, hoveredWordId, size]);

  // Click & hover mouse coordinate tracking
  const getWordAtCoords = useCallback((clientX: number, clientY: number): PlacedWord | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    return (
      wordsLayout.find((word) => {
        return (
          clickX >= word.x - word.w / 2 &&
          clickX <= word.x + word.w / 2 &&
          clickY >= word.y - word.h / 2 &&
          clickY <= word.y + word.h / 2
        );
      }) || null
    );
  }, [wordsLayout]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const word = getWordAtCoords(e.clientX, e.clientY);
    if (word) {
      setHoveredWordId(word.id);
      e.currentTarget.style.cursor = 'pointer';
    } else {
      setHoveredWordId(null);
      e.currentTarget.style.cursor = 'default';
    }
  };

  const handleMouseClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const word = getWordAtCoords(e.clientX, e.clientY);
    if (word) {
      onSelect(word.id === selectedId ? null : word.id);
    } else {
      onSelect(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className="w-full relative bg-[radial-gradient(circle_at_50%_40%,_rgb(15_23_42_/_0.2),_rgb(8_11_17_/_0.6))] rounded-xl border border-[var(--line-faint)] overflow-hidden"
      style={{ height: 220 }}
    >
      {graph.nodes.length > 0 ? (
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          onMouseMove={handleMouseMove}
          onMouseOut={() => setHoveredWordId(null)}
          onClick={handleMouseClick}
          className="block w-full h-full"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-[var(--ink-muted)] font-mono text-xs italic">
          No cloud structure yet.
        </div>
      )}
    </div>
  );
}
