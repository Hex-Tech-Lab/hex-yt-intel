# PR #442 — external review, phase-c UI-polish wave (2026-10-08)

Scope: commits 718f6580 … 6e3b329d on `phase-c` (CORS/QE unblock, highlights abort loop, timestamp seek buttons, resizable panels, history chip masks) — not the earlier Phase C engine work in the same PR.

## Round 0 (head 157cb05b) — harvested findings

| # | Source | Finding | Verdict | Resolution |
|---|---|---|---|---|
| 1 | QualityEngine (CI Lint) | 36 new/changed findings in touched files (17 in ChatDock) | VALID | ChatDock change reverted (fb35012e); remaining fixed in c5ded21e, 07a6460f, 57ced412, 103ab2f7, 6b597828 |
| 2 | Cubic P2 cors.ts:45 | Malformed Origin → error log per request | VALID | Shape pre-check before URL parse, catch keeps log (7cd52b6d) |
| 3 | Cubic P2 useHighlightsStatus:146 | A→B→A leaves badge null | VALID | Per-id result cache (c003c736) |
| 4 | Cubic P2 useHighlightsStatus:149 | Digest effect fetches while `analyzing` | VALID | Gate on `status === 'complete'` (c003c736) |
| 5 | Cubic P2 dimensionMarkdownComponents:50 | Label overrides `#t=` target | VALID | Seek from href seconds only (6b597828) |
| 6 | Cubic P2 ParityReviewClient:60 | Seek buttons with no player mounted | VALID | Wiring reverted (9a65dc5e) |
| 7 | Cubic P2 ChatDock:136 | Lost non-timestamp link fallback | VALID | Reverted (fb35012e) |
| 8 | Cubic P3 TimestampLink:97 | Space activates on keydown | VALID | Custom keydown removed from button (53a27600) |
| 9 | Cubic P2 useDashboardLayout:131 | Previous shape's sizes used on 2↔3 col switch | VALID | Shape-keyed sizes (c5ded21e) |
| 10 | Cubic P2 DashboardLayout:244 | Right rail default 18% (~260px) vs old 390px | VALID | Default 27% (c5ded21e) |
| 11 | Cubic P3 ledger ×3 | OC ledger clock times inconsistent | VALID | [NOTE] appended (6e3b329d); history not rewritten |
| 12 | DeepSource dimensionMarkdownComponents:12-14 | Short variable names | VALID | Fixed (6b597828) |
| 13 | DeepSource dimensionMarkdownComponents:18 | Function declaration in global scope | INVALID | ES module — module scope, not global |
| 14 | DeepSource dimensionMarkdownComponents:41 | Cyclomatic complexity 6 (medium) | ACCEPTED | Below refactor threshold |

## Round 1 (head 6e3b329d)
CI/CD Pipeline green incl. Lint (QualityEngine). No new Cubic/CodeRabbit inline findings. Still red, pre-existing before this wave (verified on e197d697): CodeFactor (failure), Codacy (action_required). DeepSource JavaScript web/worker failures are PR-wide (analysis range 73ad2a3…), dashboard-only.

## Missed-rule lessons
- QualityEngine observability rule only recognises `console.error`/`Sentry.captureException` written directly in the catch — a logging helper (`reportError`) is invisible to it.
- QualityEngine sibling-test rule accepts only `<dir>/` or `<dir>/__tests__/`; worker tests outside `worker/src/__tests__/` must be added to `web/vitest.config.ts` include or they never run.
