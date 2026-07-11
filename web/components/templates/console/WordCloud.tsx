'use client';

import { useEffect, useRef, useState, useCallback, useMemo, startTransition } from 'react';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';
import { entityHex, entityRgb } from '@/lib/design/entity-colors';

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
}

export function WordCloud({ graph, selectedId, onSelect }: WordCloudProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 220 });
  const hoveredWordIdRef = useRef<string | null>(null);
  const wordsLayoutRef = useRef<PlacedWord[]>([]);
  // Chip corner radius + active text color resolved from the design system
  // (canvas can't read CSS custom properties directly).
  const radiusRef = useRef(7);
  const inkRef = useRef('#E2E8F0');

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const parsedRadius = parseFloat(cs.getPropertyValue('--radius-control'));
    if (!Number.isNaN(parsedRadius)) radiusRef.current = parsedRadius;
    const ink = cs.getPropertyValue('--ink').trim();
    if (ink) inkRef.current = ink;
  }, []);

  // Resize handling with debouncing to avoid excessive re-renders
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = setTimeout(() => {
        setSize({ w: Math.max(50, el.clientWidth), h: 220 });
      }, 50);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    };
  }, []);

  // Compute collision-free layout
  const wordsLayout = useMemo(() => {
    if (!graph.nodes || graph.nodes.length === 0 || size.w < 50) return [];

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

    const maxTokenWeight = sortedTokens.length > 0 && sortedTokens[0] ? sortedTokens[0].weight : 1;
    const minTokenWeight = sortedTokens.length > 0 ? Math.min(...sortedTokens.map(t => t.weight)) : 1;
    const center = { x: size.w / 2, y: size.h / 2 };
    const placed: PlacedWord[] = [];

    // Auxiliary canvas for measuring text dimensions
    const testCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const testCtx = testCanvas ? testCanvas.getContext('2d') : null;

    const checkOverlap = (a: PlacedWord, b: PlacedWord) => {
      // Adaptive padding based on word size for better collision detection
      const basePadding = 6;
      const maxPadding = 8;
      const avgSize = (a.w + a.h + b.w + b.h) / 4;
      const padding = Math.min(maxPadding, basePadding + avgSize * 0.05);
      return (
        Math.abs(a.x - b.x) * 2 < a.w + b.w + padding &&
        Math.abs(a.y - b.y) * 2 < a.h + b.h + padding
      );
    };

    // Archimedean spiral tuned to span the canvas efficiently with adaptive parameters
    // based on available space and number of words
    const maxRadius = Math.max(size.w, size.h) / 2;
    const wordCount = Math.max(1, sortedTokens.length);
    const spiralDensity = Math.max(0.25, Math.min(0.5, 20 / wordCount));
    const angleStep = 0.35 + spiralDensity * 0.1;
    const radiusStep = maxRadius / (220 - wordCount * 0.5);
    const yScale = 0.62; // squash vertically to the canvas' wide aspect

    sortedTokens.forEach((token) => {
      const weight = token.weight;
      const logMin = Math.log(Math.max(minTokenWeight, 1));
      const logMax = Math.log(Math.max(maxTokenWeight, 1));
      let normalizedWeight: number;
      const minSpread = 0.1;

      // Improved weight normalization: use logarithmic scale for better distribution
      // when dataset has wide weight variance, linear scale for tight distributions
      if ((logMax - logMin) > minSpread) {
        normalizedWeight = (Math.log(Math.max(weight, 1)) - logMin) / (logMax - logMin);
      } else {
        const linearMin = Math.max(minTokenWeight, 1);
        const linearMax = Math.max(maxTokenWeight, 1);
        normalizedWeight = linearMax > linearMin ? (Math.max(weight, 1) - linearMin) / (linearMax - linearMin) : 0.5;
      }

      // Smooth clamping with better distribution across the font size range
      normalizedWeight = Math.max(0.15, Math.min(1, normalizedWeight));
      const fontSize = Math.max(10, Math.min(26, 10 + normalizedWeight * 16));
      const text = token.label;

      let maxTextWidth = 0;
      if (testCtx) {
        // Measure with both font weights (600 and 700) and use the maximum
        // to prevent bold text (weight 700) from extending beyond collision box
        testCtx.font = `600 ${fontSize}px Inter, sans-serif`;
        const metrics600 = testCtx.measureText(text);
        testCtx.font = `700 ${fontSize}px Inter, sans-serif`;
        const metrics700 = testCtx.measureText(text);
        maxTextWidth = Math.max(metrics600.width, metrics700.width);
      } else {
        maxTextWidth = text.length * fontSize * 0.6;
      }

      // Chip dimensions (slightly-rounded rectangle, not a pill)
      // Add extra padding to ensure bold text fits within collision box
      // Scale padding relative to font size for consistent visual spacing
      const horizontalPadding = Math.max(20, fontSize * 1.8);
      const verticalPadding = Math.max(10, fontSize * 0.8);
      const collisionBoxWidth = maxTextWidth + horizontalPadding;
      const collisionBoxHeight = fontSize + verticalPadding;

      let placedWord: PlacedWord | null = null;
      let angle = Math.random() * Math.PI * 2;
      let radius = 0;
      let iterations = 0;

      while (!placedWord && iterations < 500) {
        const x = center.x + radius * Math.cos(angle);
        const y = center.y + radius * Math.sin(angle) * yScale;

        const candidate: PlacedWord = {
          id: token.id,
          label: text,
          type: token.type,
          weight,
          x,
          y,
          w: collisionBoxWidth,
          h: collisionBoxHeight,
          fontSize,
        };

        const hasOverlap = placed.some((other) => checkOverlap(candidate, other));
        const isOutOfBounds =
          x - collisionBoxWidth / 2 < 5 ||
          x + collisionBoxWidth / 2 > size.w - 5 ||
          y - collisionBoxHeight / 2 < 5 ||
          y + collisionBoxHeight / 2 > size.h - 5;

        if (!hasOverlap) {
          if (!isOutOfBounds) {
            placedWord = candidate;
          } else {
            // Attempt to clamp candidate inside boundaries to maximize word density
            const clampedX = Math.max(collisionBoxWidth / 2 + 5, Math.min(size.w - collisionBoxWidth / 2 - 5, x));
            const clampedY = Math.max(collisionBoxHeight / 2 + 5, Math.min(size.h - collisionBoxHeight / 2 - 5, y));
            const clampedCandidate = { ...candidate, x: clampedX, y: clampedY };
            const hasOverlapAfterClamping = placed.some((other) => checkOverlap(clampedCandidate, other));
            if (!hasOverlapAfterClamping) {
              placedWord = clampedCandidate;
            }
          }
        }

        angle += angleStep;
        radius += radiusStep;
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

    const radius = radiusRef.current;

    wordsLayoutRef.current.forEach((word) => {
      const isSelected = selectedId === word.id;
      const isHovered = hoveredWordIdRef.current === word.id;
      const active = isSelected || isHovered;
      const rgb = entityRgb(word.type);

      ctx.beginPath();
      // Slightly-rounded rectangle chip (design-system radius), not a pill.
      ctx.roundRect(word.x - word.w / 2, word.y - word.h / 2, word.w, word.h, radius);
      ctx.fillStyle = `rgb(${rgb} / ${active ? 0.25 : 0.12})`;
      ctx.fill();
      ctx.strokeStyle = active ? entityHex(word.type) : `rgb(${rgb} / 0.3)`;
      ctx.lineWidth = active ? 1.5 : 0.8;
      ctx.stroke();

      ctx.fillStyle = active ? inkRef.current : entityHex(word.type);
      ctx.font = `${active ? '700' : '600'} ${word.fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(word.label, word.x, word.y);
    });
  }, [selectedId, size]);

  // Redraw when layout changes, selection changes, or dimensions are built.
  // Include wordsLayout in dependencies to trigger redraw when layout is computed.
  useEffect(() => { drawCanvas(); }, [drawCanvas, wordsLayout]);

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
      style={{ height: 220, minHeight: 220, maxHeight: 220 }}
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
        <div className="flex h-full items-center justify-center text-[var(--ink-muted)] font-mono text-xs">
          No cloud structure yet
        </div>
      )}
    </div>
  );
}
