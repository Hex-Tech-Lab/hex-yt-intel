# ADR 042: Dashboard Resizable Panels (Persisted, Desktop-Only) & Timestamp Seek Controls

**Status:** Accepted (implemented on `phase-c`, PR #442 — ba7dd0ac, c5ded21e, a73fb743, 6b597828, 53a27600)
**Date:** 2026-10-08
**Context:** The console used a fixed CSS grid (`xl:grid-cols-[260px_1fr_390px]`, or `[260px_1fr]` when no right panel) with off-canvas drawers below `xl`. Users asked for resizable columns that persist across reloads, plus a reset. Dimension markdown already linkified timestamps into `[⏱ m:ss](#t=N)` anchors (`web/lib/utils/format.tsx` `linkifyTimestamps`) routed by a shared react-markdown override, but they rendered as links rather than controls.

### Decisions

**A. Layout**
1. **Library:** `react-resizable-panels` 4.x (Group/Panel/Separator API). No library CSS is imported; handles are Tailwind/Astryx utilities only (CLAUDE.md §5 frozen stack).
2. **Desktop only.** The panel group mounts only at `xl+` (`useIsDesktop`, `matchMedia('(min-width: 1280px)')`, SSR default `false`). Below `xl` the original drawer tree (backdrop, Escape, body scroll lock, `inert`) is rendered unchanged.
3. **Persistence keyed by layout shape.** `rightPanel` is optional, so percentages are stored per shape: `hex:layout:v1:2col` / `hex:layout:v1:3col`. Reads happen post-hydration; values are range-validated and corrupt/out-of-range data falls back to defaults. Every storage access is try/catch with `console.error('[DashboardLayout]', error)`. Sizes from one shape are never applied to the other.
4. **Defaults reproduce the old grid at 1440px:** sidebar 18%, right 27% (≈390px), centre the remainder. `DEFAULT_LAYOUT` in `web/lib/hooks/useDashboardLayout.ts` is the single source; the reset path derives from it.
5. **Reset** is an icon button in `TopBar` (`xl` only) calling `requestDashboardLayoutReset()`, which clears both keys and applies defaults through the live Group's imperative `setLayout` via a single-slot registered sink (exactly one `DashboardLayout` is mounted at a time). No reload.

**B. Timestamp seek controls**
1. **`#t=` anchors in dimension views render as `<button type="button">`** via `TimestampLink asButton`, styled by one global class (`.hx-timestamp-seek` in `web/app/globals.css`). Native button activation only — no custom keydown (Space fires on keyup and stays cancellable).
2. **The seek target comes from the href seconds**, never from the visible label.
3. **No parallel linkifier.** `preprocessMarkdown`/`linkifyTimestamps` remains the only timestamp detector; views opt in by using `dimensionMarkdownComponents`.
4. **Only views with a mounted player get seek controls.** `/admin/parity-review` (no `VideoPlayerCard`) and `ChatDock` (own link fallback semantics) were deliberately left on their previous behaviour.

### Consequences

- First paint uses defaults; a persisted layout applies after hydration (no SSR mismatch, possible one-frame width change for users with saved sizes).
- The reset sink is module-level state; a second simultaneously mounted `DashboardLayout` would need a context-based registry instead.
- Tests: `web/lib/hooks/__tests__/useDashboardLayout*.test.ts`, `web/components/templates/console/__tests__/DashboardLayout.test.tsx`, `web/components/markdown/__tests__/timestamp-buttons.test.tsx`.
