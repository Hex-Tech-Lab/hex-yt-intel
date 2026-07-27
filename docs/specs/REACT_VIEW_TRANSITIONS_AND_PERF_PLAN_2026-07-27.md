# Technical Spec & Plan: React View Transitions & Vercel Performance Optimization

> **Location**: `/docs/specs/REACT_VIEW_TRANSITIONS_AND_PERF_PLAN_2026-07-27.md`  
> **Version**: 1.0.0  
> **Timestamp**: 2026-07-27T23:15:00Z  
> **Author**: Antigravity with Kelly Bakri  
> **Standards**: `vercel-react-view-transitions` & `vercel-react-best-practices`  

---

## 1. Overview & Architectural Goals

This specification outlines the execution strategy for integrating native React View Transitions (`<ViewTransition>`) and applying Vercel React Performance Best Practices across the `hex-yt-intel` workspace.

### Key Objectives
1. **Native View Transitions (`<ViewTransition>`)**: Elevate visual continuity across state changes (hero collapse, chat drawer toggle, accordion list reordering, thumbnail shared element morphs) without relying on heavy external animation libraries like Framer Motion.
2. **Bundle Optimization (`bundle-dynamic-imports`)**: Defer heavy D3 force-graph rendering (`react-force-graph-2d`) in `KnowledgeGraphCanvas` via `next/dynamic` with `ssr: false`.
3. **Loop Efficiency (`js-flatmap-filter`)**: Consolidate array `map().filter()` processing passes into single `flatMap()` passes across Knowledge Graph transformation hooks.

---

## 2. Phase 1: CSS Keyframes & Global View Transition Baseline

Add native CSS keyframes and view transition pseudo-elements to `web/app/globals.css`:

```css
/* =============================================================================
   React View Transitions (vercel-react-view-transitions)
   ============================================================================= */

:root {
  --duration-exit: 150ms;
  --duration-enter: 210ms;
  --duration-move: 350ms;
}

::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 250ms;
  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}

/* Fade Transitions */
::view-transition-old(.fade-out) {
  animation: var(--duration-exit) ease-in fade reverse;
}
::view-transition-new(.fade-in) {
  animation: var(--duration-enter) ease-out var(--duration-exit) both fade;
}

/* Slide Right Drawer Transitions */
::view-transition-old(.slide-out-right) {
  animation: var(--duration-exit) ease-in slide-right reverse;
}
::view-transition-new(.slide-in-right) {
  animation: var(--duration-enter) ease-out var(--duration-exit) both slide-right;
}

/* Shared Element Morph */
::view-transition-group(.morph) {
  animation-duration: var(--duration-move);
}

/* Accessibility: Respect Reduced Motion Settings */
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
}
```

---

## 3. Phase 2: Component View Transition Integration

### Priority 1: State Change & Drawer Motion (`enter` / `exit`)
1. **Console Hero Shrink (`AnalysisHero.tsx`)**
   - Wrap `<AnalysisHero>` in `<ViewTransition enter="fade-in" exit="fade-out" default="none">` to allow height collapse when transitioning from `idle` to `analyzing` or `complete`.

2. **Chat Dock Drawer (`ChatDock.tsx`)**
   - Wrap the chat drawer body in `<ViewTransition enter="slide-in-right" exit="slide-out-right" default="none">` for hardware-accelerated drawer sliding.

### Priority 2: List Identity (`key`)
1. **Dimension Accordion & Cards (`DashboardContainer.tsx`)**
   - Wrap each dimension card in `<ViewTransition key={`dim-${dim.number}`}>` inside `startTransition` so items morph into position smoothly as dimensions stream in.

### Priority 3: Shared Element Morphs (`name`)
1. **Video Thumbnail → Main Player Card (`AnalysisHistory.tsx` & `VideoPlayerCard.tsx`)**
   - Wrap thumbnails in `<ViewTransition name={`video-thumb-${videoId}`} share="morph">` for shared morph animations when restoring past analyses.

---

## 4. Phase 3: Vercel React Best Practices Optimizations

### Rule 1: `bundle-dynamic-imports` (Knowledge Graph Canvas)
- **File**: `web/components/templates/console/IntelligencePanel.tsx` / `KnowledgeGraphDrawer.tsx`
- **Action**: Wrap `KnowledgeGraphCanvas` in `next/dynamic`:
  ```tsx
  import dynamic from 'next/dynamic';

  const KnowledgeGraphCanvas = dynamic(
    () => import('@/components/molecules/console/KnowledgeGraphCanvas').then((m) => m.KnowledgeGraphCanvas),
    {
      ssr: false,
      loading: () => <div className="h-64 flex items-center justify-center text-xs text-mono text-[var(--muted)]">Loading Knowledge Graph...</div>,
    }
  );
  ```
- **Impact**: Cuts initial dashboard JS bundle weight by ~120KB gzipped.

### Rule 2: `js-flatmap-filter` Array Optimization
- **File**: `web/hooks/useKnowledgeGraph.ts` / `web/lib/utils/knowledge-graph-parser.ts`
- **Action**: Consolidate `map().filter(Boolean)` loops into single `flatMap()` passes:
  ```typescript
  // Optimized single-pass transformation:
  const validNodes = rawNodes.flatMap((node) => {
    const formatted = formatNode(node);
    return formatted ? [formatted] : [];
  });
  ```
- **Impact**: O(N) array allocation savings across 500+ Knowledge Graph nodes and edges.

---

## 5. Verification & Rollout Plan

1. **Type-Check Gate**:
   `pnpm --filter @hex-yt-intel/web type-check` (0 errors)
2. **Build Gate**:
   `pnpm --filter @hex-yt-intel/web build` (clean chunk splitting)
3. **Accessibility Verification**:
   Verify OS `prefers-reduced-motion: reduce` completely bypasses animations.
