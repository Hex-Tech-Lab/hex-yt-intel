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

/** Canvas-based word cloud visualization of knowledge graph entities with collision-free layout. */
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
    if (!graph.nodes || graph.nodes.length === 0 || size.w < 50) return [];

    // 1. Tokenize labels and aggregate weights
    const tokenMap: Record<string, { label: string; weight: number; type: string; id: string; maxWeight: number }> = {};

    graph.nodes.forEach(node => {
      // Prefer real content-derived keyTerms over node.label. Fine-grained entity
      // nodes (from the worker's own knowledgeGraph payload) have label = the actual
      // entity name, so label is correct there. But the client-side TF-IDF fallback
      // synthesizer (used when that real graph is missing/incomplete -- see
      // useKnowledgeGraph.ts) builds ONE NODE PER DIMENSION with label = the ALL-CAPS
      // section title ("APEX INTELLIGENCE", etc.) -- tokenizing that title produced
      // section-title fragments as fake "entities" in the word cloud. keyTerms on
      // those fallback nodes already holds real per-dimension extracted terms, so
      // prefer it whenever present; only fall back to label when it's empty.
      const sourceText = node.keyTerms && node.keyTerms.length > 0 ? node.keyTerms.join(' ') : node.label;
      const rawWords = sourceText.split(/\s+/);
      const words: string[] = [];
      for (const wItem of rawWords) {
        if (wItem.length > 2) words.push(wItem);
      }
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
      const rawWordList = node.label.split(/\s+/);
      const wordList: string[] = [];
      for (const wlItem of rawWordList) {
        if (wlItem.length > 2) wordList.push(wlItem);
      }
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
      const padding = 8;
      return (
        Math.abs(a.x - b.x) * 2 < a.w + b.w + padding &&
        Math.abs(a.y - b.y) * 2 < a.h + b.h + padding
      );
    };

    // Archimedean spiral tuned to actually span the canvas: the radius grows
    // from the center out to (and past) the edge across the iteration budget,
    // so words after the first find open space instead of piling on the center.
    const maxRadius = Math.max(size.w, size.h) / 2;
    const angleStep = 0.35;
    const radiusStep = maxRadius / 220;
    const yScale = 0.62; // squash vertically to the canvas' wide aspect

    sortedTokens.forEach((token) => {
      const weight = token.weight;
      const logMin = Math.log(Math.max(minTokenWeight, 1));
      const logMax = Math.log(Math.max(maxTokenWeight, 1));
      let normalizedWeight: number;
      const minSpread = 0.1;
      if ((logMax - logMin) > minSpread) {
        normalizedWeight = (Math.log(Math.max(weight, 1)) - logMin) / (logMax - logMin);
      } else {
        const linearMin = Math.max(minTokenWeight, 1);
        const linearMax = Math.max(maxTokenWeight, 1);
        normalizedWeight = linearMax > linearMin ? (Math.max(weight, 1) - linearMin) / (linearMax - linearMin) : 0.5;
      }
      normalizedWeight = Math.max(0.2, Math.min(1, normalizedWeight));
      // Apply power-based scaling (exponent 2.2) to create SUBSTANTIAL visual differentiation
      // between high-weight and low-weight words. E.g.: 0.2 → 0.04, 1.0 → 1.0
      const scaledWeight = Math.pow(normalizedWeight, 2.2);
      const fontSize = Math.max(10, Math.min(32, 10 + scaledWeight * 22));
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
      const collisionBoxWidth = maxTextWidth + 24;
      const collisionBoxHeight = fontSize + 12;

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

  // CodeRabbit review, PR #181: `wordsLayout` is a useMemo keyed partly on
  // `size.w` (ResizeObserver-driven), so a resize that doesn't actually
  // change which words are present still produces a NEW array reference --
  // e.g. dragging a window edge. The entrance-animation effect below only
  // needs to restart when the actual SET of words changes; gating it on a
  // stable id-based key instead of the array reference stops window-resize
  // from replaying the whole pop-in animation. Safe because the animation
  // loop itself only reads `word.id`/index for stagger timing (position is
  // always read fresh from wordsLayoutRef in drawCanvas, never from this
  // closure), so a key-only dependency can't leave stale positions on screen.
  const wordsLayoutKey = useMemo(() => wordsLayout.map((w) => w.id).join(','), [wordsLayout]);

  // Track animation progress per word id
  const wordProgressRef = useRef<Record<string, number>>({});
  const animFrameRef = useRef<number | null>(null);
  // Flips true once the empty-state pulse has run past EMPTY_PULSE_TIMEOUT_MS
  // with no words -- stops the rAF loop and swaps to a static "no data"
  // message instead of pulsing "Synthesizing..." forever.
  const emptyTimedOutRef = useRef(false);
  // React-state mirror of emptyTimedOutRef, for the accessible label only
  // (CodeRabbit review, PR #181): the canvas has no text content a screen
  // reader can read, so this state drives an aria-label that announces
  // word count / synthesizing / empty, updating on the same transition the
  // ref-only canvas repaint already reacts to.
  const [isEmptyTimedOut, setIsEmptyTimedOut] = useState(false);

  // Imperative canvas draw — no React re-render needed for hover
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size.w, size.h);

    const words = wordsLayoutRef.current;

    if (words.length === 0) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '12px Inter, sans-serif';
      if (emptyTimedOutRef.current) {
        // Timed out with no data -- this is a genuinely empty analysis, not
        // one still synthesizing. Static text, no more animation.
        ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
        ctx.fillText('No cloud structure yet', size.w / 2, size.h / 2);
      } else {
        const now = Date.now() / 1000;
        const alpha = 0.35 + 0.35 * Math.sin(now * 3);
        ctx.fillStyle = `rgba(148, 163, 184, ${alpha})`;
        ctx.fillText('Synthesizing word cloud...', size.w / 2, size.h / 2);
      }
      ctx.restore();
      return;
    }

    const radius = radiusRef.current;

    words.forEach((word) => {
      const progress = wordProgressRef.current[word.id] ?? 1;
      if (progress <= 0) return;

      const isSelected = selectedId === word.id;
      const isHovered = hoveredWordIdRef.current === word.id;
      const active = isSelected || isHovered;
      const rgb = entityRgb(word.type);

      const scale = 0.5 + 0.5 * progress;
      const alpha = progress;

      ctx.save();
      ctx.translate(word.x, word.y);
      ctx.scale(scale, scale);

      ctx.beginPath();
      // Slightly-rounded rectangle chip (design-system radius), not a pill.
      ctx.roundRect(-word.w / 2, -word.h / 2, word.w, word.h, radius);
      ctx.fillStyle = `rgb(${rgb} / ${(active ? 0.25 : 0.12) * alpha})`;
      ctx.fill();
      ctx.strokeStyle = active ? entityHex(word.type) : `rgb(${rgb} / ${0.3 * alpha})`;
      ctx.lineWidth = active ? 1.5 : 0.8;
      ctx.stroke();

      ctx.fillStyle = active ? inkRef.current : entityHex(word.type);
      ctx.globalAlpha = alpha;
      ctx.font = `${active ? '700' : '600'} ${word.fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(word.label, 0, 0);

      ctx.restore();
    });
  }, [selectedId, size]);

  // react-best-practices self-review finding (2026-08-02): the entrance
  // animation effect below used to list `drawCanvas` directly in its deps.
  // drawCanvas is recreated whenever selectedId changes (e.g. clicking a
  // word), which restarted the whole stagger-animation effect -- including
  // resetting `startTime` -- so selecting a word replayed the pop-in
  // animation for every word from scratch. Route calls through a ref so the
  // effect only restarts when the actual word data changes.
  const drawCanvasRef = useRef(drawCanvas);
  useEffect(() => {
    drawCanvasRef.current = drawCanvas;
    // Repaint once on any change drawCanvas itself reacts to (selectedId or
    // size) -- clicking a word to select it must still update the highlight
    // immediately, without waiting for a stray mouse-move to trigger it or
    // (worse) going through the entrance-animation effect, which would
    // restart the pop-in for every word again.
    drawCanvas();
  }, [drawCanvas]);

  // Staggered pop-in reveal animation & empty pulse loop
  useEffect(() => {
    if (wordsLayout.length === 0) {
      // Bounded, not indefinite: an analysis that completes with genuinely
      // zero entities would otherwise pulse "Synthesizing..." forever and
      // burn an rAF loop forever, since this component has no isAnalyzing/
      // status prop to distinguish "still working" from "permanently empty".
      let active = true;
      const startedAt = Date.now();
      const EMPTY_PULSE_TIMEOUT_MS = 8000;
      const loop = () => {
        if (!active) return;
        if (Date.now() - startedAt > EMPTY_PULSE_TIMEOUT_MS) {
          emptyTimedOutRef.current = true;
          setIsEmptyTimedOut(true);
          drawCanvasRef.current();
          return;
        }
        drawCanvasRef.current();
        animFrameRef.current = requestAnimationFrame(loop);
      };
      emptyTimedOutRef.current = false;
      setIsEmptyTimedOut(false);
      loop();
      return () => {
        active = false;
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };
    }

    const startTime = performance.now();
    let active = true;

    const animate = (now: number) => {
      if (!active) return;
      const elapsed = now - startTime;

      let allComplete = true;
      wordsLayout.forEach((word, idx) => {
        const delay = (idx / Math.max(1, wordsLayout.length)) * 350;
        const p = Math.min(1, Math.max(0, (elapsed - delay) / 250));
        const eased = 1 - Math.pow(1 - p, 3);
        wordProgressRef.current[word.id] = eased;
        if (eased < 1) allComplete = false;
      });

      drawCanvasRef.current();

      if (!allComplete) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [wordsLayoutKey]);

  // Click & hover mouse coordinate tracking
  const getWordAtCoords = useCallback((clientX: number, clientY: number): PlacedWord | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    return (
      wordsLayout.find((word) => {
        // Ignore words still mid entrance-animation (or not yet started) --
        // their final bounding box is hit-tested here even though they're
        // barely/not visible during the ~600ms stagger-in window, letting a
        // click land on a word that isn't really there yet.
        const progress = wordProgressRef.current[word.id] ?? 1;
        if (progress < 0.5) return false;
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

  const canvasAccessibleLabel =
    wordsLayout.length > 0
      ? `Word cloud showing ${wordsLayout.length} key term${wordsLayout.length === 1 ? '' : 's'}${selectedId ? ', one term selected' : ''}`
      : isEmptyTimedOut
        ? 'Word cloud: no data available for this analysis'
        : 'Word cloud: synthesizing';

  return (
    <div
      ref={containerRef}
      className="w-full relative bg-[radial-gradient(circle_at_50%_40%,_rgb(15_23_42_/_0.2),_rgb(8_11_17_/_0.6))] rounded-lg border border-[var(--line-faint)] overflow-hidden"
      style={{ height: 220, minHeight: 220, maxHeight: 220 }}
    >
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        onMouseMove={handleMouseMove}
        onMouseOut={() => { hoveredWordIdRef.current = null; drawCanvas(); }}
        onClick={handleMouseClick}
        className="block w-full h-full js-word-cloud-canvas"
        role="img"
        aria-label={canvasAccessibleLabel}
      />
    </div>
  );
}

