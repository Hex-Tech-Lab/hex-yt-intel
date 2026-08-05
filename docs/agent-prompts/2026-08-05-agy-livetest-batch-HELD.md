# AGY Prompt — Live-Test Batch (UI), 2026-08-05 (HELD until AGY available)

You are AGY (Antigravity/Gemini). UI-focused execution on all items below. Every mandatory section is required in your final report.

## Contract definitions

- **#1 chat table formatting**: chat message table columns render "very strange" per screenshot, last column contents look wrong/doubtful. Contract: identify the table component (grep chat message rendering for a `<table>`/grid), define correct column widths/alignment per our design system, and verify the data actually populating the last column is the right field (this may be a data-mapping bug wearing a styling costume — check before assuming pure CSS).
- **#4 button styling**: button must move far right, smaller, NOT rounded (rectangular/sharp corners matching Astryx design tokens — use the smallest available corner-radius token if a hard 0 isn't in the system), description text moves from inline to tooltip-only, add an aria keyboard-shortcut hint, and tooltip background must use a design-system shade (not white — this is the same root cause as #8, fix once and reuse). Contract: match `@astryxdesign/core` button/tooltip primitives exactly — verify actual exported props via `.d.ts`, don't guess prop names.
- **#5a signal bars visual**: redesign into 6 horizontal bars with a gradient/step from orange (low) → yellow (mid) → green (high signal). This is presentation-only — the underlying weight/scoring algorithm ("upper weight syndrome," bars clustering 5-10) is being fixed separately by OC on the backend; do not touch scoring logic, only the bar rendering and color mapping against whatever score value the component already receives.
- **#8 tooltips white background, global**: every tooltip in the app uses a white background regardless of theme/dark-mode. Contract: find the shared tooltip primitive/wrapper (likely one Astryx `Tooltip` usage point or a global CSS override) and fix at the source, not per-instance — if there are multiple ad hoc tooltip implementations instead of one shared primitive, flag that as a tangent (that itself is the root cause, not each individual usage).
- **#16 Cloudflare log table cramming**: last column crams in the CF logs table (image #59) — same class of bug as #1 (last-column formatting) but a different table/component. Contract: check whether this shares a table component with #1 or the Supabase logs table — if there's a shared `LogTable`/generic table component, fix the column-sizing logic there once rather than duplicating a per-table patch.
- **#7a history title display** (BLOCKED — do this only if OC has already merged its #14 fix): once OC's backend fix stops writing bad titles going forward, existing already-bad rows will still show wrong titles in the history list. Contract: verify whether the existing `mapHistoryOverviewRow` fallback (from an earlier session's "History Title Fallback" fix) already covers a present-but-wrong title, or only a missing/null one — if only the latter, this needs either a display-layer guard (detect date-shaped strings as suspect) or is genuinely a data-backfill problem out of UI scope. Do not attempt a backfill yourself — flag it back to CC if that's what's needed.

## E2E verification required (not just visual/unit-green)

- #1, #16: real page load in a running dev instance with real data, screenshot the table, confirm columns are legible and the flagged column now shows correct data.
- #4: real click/hover in dev — confirm tooltip appears on hover, keyboard shortcut actually works (not just aria-labeled), button position/size visually matches spec.
- #5a: real page load with an analysis that has a range of signal scores (low/mid/high), confirm all three color bands actually render, not just the top end.
- #8: hover every distinct tooltip trigger type in the app (button, table cell, sidebar icon, etc.) — confirm none render white.

## Tangent hunt

While in tooltip code for #8 and #4, check for other hardcoded white/light backgrounds in overlay-type components (popovers, dropdowns, modals) that might share the same root cause. While in table components for #1/#16, check the same generic table for column-cramming on ANY other column, not just the one flagged.

## RCA before fix

Required, visible, separate step for every item.

## Skills — enumerate live, not from memory

CORE (every item): qa-intel, contract-auditor, `/simplify`.
SELECT — pick fresh per Phase 1 trigger list in `.claude/skills/pr-review-workflow`: this entire batch touches UI/UX and markup → `web-design-guidelines` is mandatory for all of it. Component prop changes on buttons/tooltips (#4, #8) → `composition-patterns`. React re-render/bundle concerns if any new state is introduced → `react-best-practices`.

## Report format (mandatory)

For EACH item: RCA → Contract → Fix → Tangents found → Skills run + findings → Gates → Files changed. CC independently verifies every claim against real sources (screenshots, actual rendered DOM, real prop catalogs) before merging.
