'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, startTransition } from 'react';
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

  // CodeRabbit review, PR #181: `wordsLayout` is a useMemo keyed partly on
  // `size.w` (ResizeObserver-driven), so a resize that doesn't actually
  // change which words are present still produces a NEW array reference --
  // e.g. dragging a window edge. The entrance-animation effect below only
  // needs to restart when the actual SET of words changes; gating it on a
  // stable key instead of the array reference stops window-resize from
  // replaying the whole pop-in animation. Safe because the animation loop
  // itself only reads `word.id`/index for stagger timing (position is
  // always read fresh from wordsLayoutRef in drawCanvas, never from this
  // closure), so a key-only dependency can't leave stale positions on
  // screen. Includes `label`, not just `id`: multiple distinct tokens
  // extracted from the SAME underlying node all share that node's id (see
  // the tokenMap construction above), so an id-only key could fail to
  // detect a genuine content change if the id sequence happened to repeat
  // (second CodeRabbit finding on this same PR). Declared before the
  // layout-sync effect below (not after, as an earlier version of this fix
  // had it) since a dependency array is evaluated during render, unlike an
  // effect body -- referencing it before this point is a real TDZ
  // compile error, not just an ordering style nit.
  const wordsLayoutKey = useMemo(
    () => wordsLayout.map((w) => `${w.id}:${w.label}`).join(','),
    [wordsLayout]
  );

  // Store layout in ref for imperative access, and repaint immediately.
  // CodeRabbit review, PR #181: the entrance-animation effect is now gated
  // on wordsLayoutKey (a stable id+label key) rather than this array's
  // reference, so a resize that shifts word positions without changing the
  // word set no longer restarts the animation -- but nothing else was
  // repainting the canvas for that case either, leaving stale pixel
  // positions on screen until an incidental mouse move. drawCanvasRef.current
  // is safe to call here even though its own declaration appears later in
  // this component: useRef(drawCanvas) already initializes `.current`
  // synchronously during render, before any effect runs.
  // Live-test regression found 2026-08-02: during an in-progress analysis
  // the knowledge graph streams in incrementally (one node/edge at a time,
  // ~30 SSE updates for a single video), so wordsLayoutKey changes on
  // nearly every chunk. The earlier "clear all progress on any key change"
  // fix (below, superseded) was correct for the narrow "switched to a
  // genuinely different analysis" case Cubic flagged, but during live
  // streaming it meant the WHOLE cloud reset and replayed its entrance
  // animation ~30 times in a row -- the reported "stuttering, words
  // appearing then disappearing" bug. ponytail: this doesn't need a
  // key-diff special case at all. Pruning only the ids that actually left
  // the set (never bulk-clearing) gives the right behavior for both cases
  // for free: incremental growth keeps already-visible words at their
  // progress and only animates the new ones in; a genuinely different
  // analysis's ids simply aren't in the old map to begin with.
  useLayoutEffect(() => {
    wordsLayoutRef.current = wordsLayout;
    const currentIds = new Set(wordsLayout.map((w) => w.id));
    for (const id of Object.keys(wordProgressRef.current)) {
      if (!currentIds.has(id)) delete wordProgressRef.current[id];
    }
    for (const id of Object.keys(wordStartedAtRef.current)) {
      if (!currentIds.has(id)) delete wordStartedAtRef.current[id];
    }
    drawCanvasRef.current();
  }, [wordsLayout]);

  // Track animation progress per word id
  const wordProgressRef = useRef<Record<string, number>>({});
  // Per-word entrance-animation start time. Each word animates from ITS OWN
  // first-seen moment, not a shared array-level timer -- during a live
  // analysis the knowledge graph streams in one node at a time (~30 SSE
  // updates for one video), so this effect legitimately restarts often.
  // With a shared timer, every restart recomputed every word's progress
  // (including already-visible ones) from idx-based delay against the
  // CURRENT array size, causing the whole cloud to stutter/replay on every
  // incremental update (live-test regression, 2026-08-02). Per-word start
  // times mean a restart only assigns a start time to genuinely NEW words;
  // already-animating ones are untouched.
  const wordStartedAtRef = useRef<Record<string, number>>({});
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
      // CodeRabbit review, PR #181: the initial drawCanvas() call (fired
      // from the drawCanvasRef-sync effect) can run before the entrance
      // animation's first requestAnimationFrame tick populates
      // wordProgressRef -- defaulting to 1 there made brand-new words flash
      // fully visible for one frame before actually animating in. 0 is the
      // honest "hasn't started yet" state.
      const progress = wordProgressRef.current[word.id] ?? 0;
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
      // /simplify efficiency finding (2026-08-02): this is a slow sine
      // pulse (one cycle per ~2s) -- redrawing the full canvas at 60fps for
      // it is wasted work (font-string realloc + clearRect + fill/stroke,
      // every 16ms, for up to 8s per empty analysis). ~24fps is visually
      // indistinguishable for a pulse this slow.
      const PULSE_FRAME_INTERVAL_MS = 1000 / 24;
      let lastFrameAt = 0;
      const loop = (now: number) => {
        if (!active) return;
        if (Date.now() - startedAt > EMPTY_PULSE_TIMEOUT_MS) {
          emptyTimedOutRef.current = true;
          setIsEmptyTimedOut(true);
          drawCanvasRef.current();
          return;
        }
        if (now - lastFrameAt >= PULSE_FRAME_INTERVAL_MS) {
          lastFrameAt = now;
          drawCanvasRef.current();
        }
        animFrameRef.current = requestAnimationFrame(loop);
      };
      emptyTimedOutRef.current = false;
      setIsEmptyTimedOut(false);
      loop(performance.now());
      return () => {
        active = false;
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };
    }

    let active = true;

    // Assign a start time to any word that hasn't animated yet (words
    // already in wordStartedAtRef -- from a previous run of this effect --
    // keep their existing start time untouched). Stagger only among the
    // words that are new IN THIS BATCH, not against the full current
    // array's index -- during live streaming, "this batch" is usually just
    // one word, so it gets no artificial delay; on initial load of a
    // completed analysis, all words arrive in one batch and stagger
    // together as before.
    const now0 = performance.now();
    const newWords = wordsLayout.filter((w) => wordStartedAtRef.current[w.id] === undefined);
    newWords.forEach((word, idx) => {
      wordStartedAtRef.current[word.id] = now0 + (idx / Math.max(1, newWords.length)) * 350;
    });

    const animate = (now: number) => {
      if (!active) return;

      let allComplete = true;
      wordsLayout.forEach((word) => {
        const startedAt = wordStartedAtRef.current[word.id] ?? now;
        const elapsed = now - startedAt;
        const p = Math.min(1, Math.max(0, elapsed / 250));
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
        // click land on a word that isn't really there yet. Defaulting to 0
        // (not 1) for words with no progress entry yet matches drawCanvas's
        // own default (CodeRabbit review, PR #181) -- a brand-new word
        // should never be hit-testable before it's actually started
        // animating in.
        const progress = wordProgressRef.current[word.id] ?? 0;
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

  // CodeRabbit review, PR #181: `selectedId` truthiness alone doesn't mean
  // a rendered term matches it -- selectedId can reference a node with zero
  // words currently in wordsLayout, or (since multiple tokens can share one
  // node's id) more than one. Counting actual matches keeps the label
  // honest, including the zero case.
  const selectedWordCount = selectedId ? wordsLayout.filter((w) => w.id === selectedId).length : 0;
  const canvasAccessibleLabel =
    wordsLayout.length > 0
      ? `Word cloud showing ${wordsLayout.length} key term${wordsLayout.length === 1 ? '' : 's'}${
          selectedWordCount > 0 ? `, ${selectedWordCount} term${selectedWordCount === 1 ? '' : 's'} selected` : ''
        }`
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
      {/* web-design-guidelines review (2026-08-02): aria-label alone is a
          static accessible name -- changing it (synthesizing -> N words ->
          selection changes) does NOT trigger a screen-reader announcement,
          only aria-live regions do. The canvas's own aria-label above still
          describes it correctly whenever it's discovered/focused; this
          visually-hidden live region is what actually announces the state
          transitions. */}
      <div aria-live="polite" className="sr-only">
        {canvasAccessibleLabel}
      </div>
    </div>
  );
}

