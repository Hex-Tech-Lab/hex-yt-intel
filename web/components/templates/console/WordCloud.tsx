'use client';

import { useEffect, useRef, useState, useCallback, useMemo, startTransition } from 'react';
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
  bgRgb: string;
}

const TYPE_COLORS: Record<string, { text: string; bg: string }> = {
  person: { text: '#f43f5e', bg: '244 63 94' },
  concept: { text: '#a855f7', bg: '168 85 247' },
  framework: { text: '#eab308', bg: '234 179 8' },
  tool: { text: '#06b6d4', bg: '6 182 212' },
  organization: { text: '#3b82f6', bg: '59 130 246' },
  study: { text: '#10b981', bg: '16 185 129' },
  trend: { text: '#f97316', bg: '249 115 22' },
  metric: { text: '#ec4899', bg: '236 72 153' },
};

export function WordCloud({ graph, selectedId, onSelect }: WordCloudProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 220 });
  const hoveredWordIdRef = useRef<string | null>(null);
  const wordsLayoutRef = useRef<PlacedWord[]>([]);

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

    // 1. Tokenize labels and aggregate weights
    const tokenMap: Record<string, { label: string; weight: number; type: string; id: string; maxWeight: number }> = {};
    
    graph.nodes.forEach(node => {
      const words = node.label.split(/\s+/).filter(w => w.length > 2);
      words.forEach(word => {
        const key = word.toLowerCase().replace(/[^\w]/g, '');
        if (!key || key.length < 3) return;
        
        if (!tokenMap[key]) {
          tokenMap[key] = {
            label: word,
            weight: node.weight || 1,
            type: node.entityType || 'concept',
            id: node.id,
            maxWeight: node.weight || 1,
          };
        } else {
          tokenMap[key].weight += (node.weight || 1) * 0.6;
          const nw = node.weight || 1;
          if (nw > (tokenMap[key].maxWeight ?? 0)) {
            tokenMap[key].maxWeight = nw;
            tokenMap[key].id = node.id;
          }
        }
      });
    });

    // Also extract bigrams (two-word phrases) for richer cloud
    graph.nodes.forEach(node => {
      const wordList = node.label.split(/\s+/).filter(w => w.length > 2);
      for (let i = 0; i < wordList.length - 1; i++) {
        const bigram = `${wordList[i]} ${wordList[i + 1]}`;
        const key = bigram.toLowerCase().replace(/[^\w\s]/g, '');
        if (key.length < 5) continue;
        if (!tokenMap[key]) {
          tokenMap[key] = {
            label: bigram,
            weight: (node.weight || 1) * 0.8,
            type: node.entityType || 'concept',
            id: node.id,
            maxWeight: node.weight || 1,
          };
        } else {
          tokenMap[key].weight += (node.weight || 1) * 0.4;
        }
      }
    });

    const sortedTokens = Object.values(tokenMap)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 50);

    const center = { x: size.w / 2, y: size.h / 2 };
    const placed: PlacedWord[] = [];

    // Auxiliary canvas for measuring text dimensions
    const testCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const testCtx = testCanvas ? testCanvas.getContext('2d') : null;

    const checkOverlap = (a: PlacedWord, b: PlacedWord) => {
      const padding = 8;
      return (
        Math.abs(a.x - b.x) * 2 < a.w + b.w + padding &&
        Math.abs(a.y - b.y) * 2 < a.h + b.h + padding
      );
    };

    sortedTokens.forEach((token) => {
      const weight = token.weight;
      const fontSize = Math.max(10, Math.min(15, 9 + weight * 0.8));
      const text = token.label;

      if (testCtx) {
        testCtx.font = `600 ${fontSize}px Inter, sans-serif`;
      }
      const textMetrics = testCtx ? testCtx.measureText(text) : { width: text.length * fontSize * 0.6 };
      
      // Pill dimensions
      const w = textMetrics.width + 16; 
      const h = fontSize + 10;

      let placedWord: PlacedWord | null = null;
      let theta = Math.random() * Math.PI * 2;
      const step = 0.12;
      const spiralSpread = 2.2;
      let iterations = 0;

      while (!placedWord && iterations < 400) {
        const distance = step * theta * spiralSpread;
        const x = center.x + distance * Math.cos(theta);
        const y = center.y + distance * Math.sin(theta) * 0.8;

        const theme = TYPE_COLORS[token.type] || { text: '#94a3b8', bg: '148 163 184' };
        const candidate: PlacedWord = {
          id: token.id,
          label: text,
          type: token.type,
          weight,
          x,
          y,
          w,
          h,
          fontSize,
          color: theme.text,
          bgRgb: theme.bg,
        };

        const hasOverlap = placed.some((other) => checkOverlap(candidate, other));
        const isOutOfBounds =
          x - w / 2 < 5 ||
          x + w / 2 > size.w - 5 ||
          y - h / 2 < 5 ||
          y + h / 2 > size.h - 5;

        if (!hasOverlap && !isOutOfBounds) {
          placedWord = candidate;
        }

        theta += step;
        iterations++;
      }

      if (placedWord) placed.push(placedWord);
    });

    return placed;
  }, [graph.nodes, size.w, size.h]);

  // Store layout in ref for imperative access
  useEffect(() => {
    wordsLayoutRef.current = wordsLayout;
  }, [wordsLayout]);

  // Imperative canvas draw — no React re-render needed for hover
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size.w, size.h);

    wordsLayoutRef.current.forEach((word) => {
      const isSelected = selectedId === word.id;
      const isHovered = hoveredWordIdRef.current === word.id;
      const active = isSelected || isHovered;

      ctx.beginPath();
      ctx.roundRect(word.x - word.w / 2, word.y - word.h / 2, word.w, word.h, word.h / 2);
      ctx.fillStyle = `rgba(${word.bgRgb}, ${active ? 0.25 : 0.12})`;
      ctx.fill();
      ctx.strokeStyle = active ? word.color : `rgba(${word.bgRgb}, 0.3)`;
      ctx.lineWidth = active ? 1.5 : 0.8;
      ctx.stroke();

      ctx.fillStyle = active ? '#ffffff' : word.color;
      ctx.font = `${active ? '700' : '600'} ${word.fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(word.label, word.x, word.y);
    });
  }, [selectedId, size]);

  // Redraw when layout or selection changes
  useEffect(() => { drawCanvas(); }, [drawCanvas]);

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
    const newId = word?.id ?? null;
    if (hoveredWordIdRef.current !== newId) {
      hoveredWordIdRef.current = newId;
      e.currentTarget.style.cursor = word ? 'pointer' : 'default';
      drawCanvas();
    }
  };

  const handleMouseClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const word = getWordAtCoords(e.clientX, e.clientY);
    startTransition(() => {
      onSelect(word ? (word.id === selectedId ? null : word.id) : null);
    });
  };

  return (
    <div
      ref={containerRef}
      className="w-full relative bg-[radial-gradient(circle_at_50%_40%,_rgb(15_23_42_/_0.2),_rgb(8_11_17_/_0.6))] rounded-lg border border-[var(--line-faint)] overflow-hidden"
      style={{ height: 220 }}
    >
      {graph.nodes.length > 0 ? (
        <canvas
          ref={canvasRef}
          width={size.w}
          height={size.h}
          onMouseMove={handleMouseMove}
          onMouseOut={() => { hoveredWordIdRef.current = null; drawCanvas(); }}
          onClick={handleMouseClick}
          className="block w-full h-full js-word-cloud-canvas"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-[var(--ink-muted)] font-mono text-xs italic">
          No cloud structure yet.
        </div>
      )}
    </div>
  );
}
