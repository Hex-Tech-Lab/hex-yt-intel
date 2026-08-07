# Agent Dispatch Prompt — History Chips vs. Synth Console Chips State Mismatch (AGY)

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — read it now
if you haven't already. Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md`
before touching any file; post `[IN_PROGRESS]` with intent + target files as
your first action; re-check the ledger after every subtask; post
`[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually
happened (not what you intended) as your last action; use the
`[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.

## 1. Context

hex-yt-intel: YouTube video analysis platform, Next.js/React 19/Zustand,
`web/` directory. There are two places in the UI that show per-video
"aux data status" as small colored chips:

1. **`web/components/templates/console/AnalysisHistory.tsx`** — the history
   list, one row per past analysis. Each row shows chips (Digest,
   Description, Channel Meta, Comments, Chapters via the newly-shared
   `ChapterChip`, platform chip) computed from `useHistoryOverview()`'s
   server-fetched `HistoryOverviewItem` data (a DB read, `get_user_history_overview`
   RPC — see `web/lib/utils/history-overview.ts`).
2. **`web/components/containers/DashboardContainer.tsx`** (around line 661-672)
   — the live "synth console" screen for the CURRENTLY OPEN analysis. Same
   concept, same chips (`StatusBadge` for Digest/Description/Channel
   Meta/Comments, `ChapterChip` for chapters — both now imported from
   `web/components/templates/_shared/primitives.tsx`, unified there just
   before this dispatch, commit `44b56a84`), but computed from CLIENT-SIDE
   live state (`useAuxElementStatus(analysisId, status)` hook, plus
   `useChapters()` for chapters, plus local `digest` state) — NOT the same
   data source as #1.

**User's live iPad test report (2026-08-07)**: "the history chips do not
map to the synth log chips" — meaning for the SAME analysis, viewed once
via the history list and once via the live console, the chip states
(green/idle/done) don't agree. Reported alongside 3 other findings from the
same test session; this is the only one not yet investigated or assigned.

## 2. Task

Investigate WHY the two chip sources disagree for the same analysis, and
fix it. Do NOT assume the root cause before investigating — these two chip
rows are fed by genuinely different code paths (one server RPC read, one
client-side live hook state), so there are several plausible causes worth
actually checking, not guessing at:

- **Timing/staleness**: does `useAuxElementStatus` (client, live) settle to
  the correct state before/after the DB-backed `HistoryOverviewItem` row is
  written for the same analysis? A real analysis lifecycle race (client
  thinks "done" before the DB row reflects it, or vice versa) would produce
  exactly this symptom.
- **Different underlying truth**: does `get_user_history_overview`'s
  `has_chapters`/similar fields use a genuinely different definition of
  "present" than the client hooks do (e.g. one checks `chapters.length > 0`,
  the other checks a different DB column or a stale cached value)?
- **Restore-path gap**: when a user opens a PAST analysis from history
  (`AnalysisHistory.tsx`'s `restoreAnalysis`, calls `initSynthesis`/
  `setKnowledgeGraph`/etc.), does the client-side aux-status state actually
  get repopulated from the restored analysis's real data, or does it reset
  to a default/idle state that doesn't match what history showed?

Find the actual file:line where the two sources diverge for a real
before/after case, not just a theoretical mismatch.

## 3. Goal / definition of done

A stated, verified root cause (which of the above, or a different one found
during investigation) with a real reproduction — restore a completed
analysis from history, compare its history-row chip states against its
live-console chip states for the same fields, show the actual values that
disagreed and why. Then a fix that makes them agree, verified the same way
post-fix (not just "code looks right").

## 4. Expected results

- RCA document (in the report, not a separate file) naming the exact
  divergence mechanism.
- Fix applied so the same analysis shows the same chip states in both
  places.
- If the fix reveals the two chip rows *should* share more than just the
  `ChapterChip`/`StatusBadge` visual components (e.g. a shared "compute aux
  status for analysis X" function used by both the RPC-backed and
  client-backed paths) — that's in scope; this project's user has an
  explicit standing preference for shared/modular status-computation logic
  over independently-maintained parallel implementations (see the
  `ChapterChip` unification commit `44b56a84` as the precedent for this
  exact pattern).

## 5. Task-specific skills/tools/plugins/MCPs

CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets are
[ALWAYS INCLUDE] below. Beyond that: `react-best-practices` applies (this
is a React state/data-sync bug). If the root cause turns out to be
DB-side (an RPC field definition mismatch), check
`supabase-postgres-best-practices` too, and verify the live schema/RPC
behavior via the Supabase MCP (`execute_sql` wrapped in
`BEGIN...ROLLBACK`) rather than assuming from the migration file text.

## 6. Fixtures

**code-review-graph MCP**: this project's CLAUDE.md mandates
`build_or_update_graph_tool` then `get_review_context_tool`/
`get_impact_radius_tool` as Step 0 before Grep/Glob/Read. If that MCP
server isn't connected in your environment, fall back to Grep/Read
directly and note the fallback in your report — don't skip investigation
waiting on it.

Start from `main` at commit `383f9be8` or later. Read
`web/hooks/useAuxElementStatus.ts` (or find its actual location if the name
is slightly different — grep for `useAuxElementStatus`), `web/lib/utils/history-overview.ts`,
and `web/components/templates/console/AnalysisHistory.tsx`'s `restoreAnalysis`
function (around line 290-370) as the three starting points.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the exact input→output
   contract for what you're building BEFORE writing it. After writing it,
   check the diff against that stated contract.
2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
   passing unit test is NOT sufficient evidence — trace the real path with
   actual proof (restore a real analysis, screenshot/describe the actual
   before/after chip states, not a mock).
3. **Tangent hunt as you walk the workflow.** While touching each file,
   check adjacent chips/status fields for the same class of gap (not just
   the one field the user happened to notice).

**If you cannot complete a full cycle, or find a design gap mid-task, STOP
and report the specific deviation and why**, rather than shipping a partial
fix under a "done" label.

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (cite actual command/query output, not
"tests pass") → Tangents found → Deviations flagged (if any) → Skills run +
findings → Gates (exact output) → Files changed. CC independently
re-verifies every claim against real code and real system state before
accepting — a report claiming "done" without this structure, or without E2E
proof, will be rejected and sent back.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' — empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # EXACT CI flags, not the bare default run
pnpm tsx web/scripts/contract-auditor.ts
```
