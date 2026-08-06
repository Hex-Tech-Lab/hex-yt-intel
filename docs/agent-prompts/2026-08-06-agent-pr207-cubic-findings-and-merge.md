# Agent Dispatch Prompt — PR #207: Resolve Cubic Findings, Get CI Green, Merge

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

## 1. Context

Branch `fix/wordcloud-cluster-and-date-title`, PR #207
(https://github.com/Hex-Tech-Lab/hex-yt-intel/pull/207), base `main`, current
head `cfdb32b1`. This PR fixes three live-test bugs found on an iPad session
2026-08-06: (a) a WordCloud "clustering" artifact where clicking one word
highlighted several unrelated-looking words together, because they all
derived from the same underlying KG node id, (b) a video showing a bare date
as its title in history when `channel_title` was null, (c) a Dimension-0
executive-digest accordion that only showed on restored (already-digested)
historical analyses, never on a freshly-completed live one.

A Cubic-style review pass (pasted by the user, not yet independently
verified by CC) flagged 1 P0 (a failing DeepSource doc-comment check) and
several P1/P2 findings, concentrated in the WordCloud fix's new ref-based
selection state. CC's own read of the WordCloud fix: it deliberately keeps
`onSelect` node-id-based for cross-panel sync (KnowledgeGraphCanvas, MindMap,
IntelligencePanel all still key off `selectedId` = node id) while adding a
LOCAL `wordKey`-based highlight-only mechanism (`lastClickedWordKeyRef`,
`lastSelfSelectedIdRef`) so a click highlights only the specific word
clicked, falling back to "highlight every word sharing that node id" when
`selectedId` changes for a reason other than this component's own click.
Read the current file yourself before trusting either CC's summary above or
Cubic's findings below — some Cubic findings may already not apply, or may
be real gaps CC missed.

**This session's standing rule**: no review-tool finding is accepted at
face value. Verify each against the real current code before fixing.

## 2. Task

Work through the Cubic findings below, each independently verified against
the ACTUAL current file content (not the line numbers Cubic cited, which may
have drifted) before fixing. For each: state VALID (with evidence) or FALSE
POSITIVE (with evidence) before touching anything.

**P0 — DeepSource doc-comment failure on `sanitizeLogMessage`**
(`web/store/useAnalysisStore.ts`). Check whether this check fails on `main`
too (i.e., pre-existing) or only on this branch. If pre-existing: do NOT
expand this PR to fix it — note it in the report as baseline noise and move
on (this project's CI confidence formula does not weight DeepSource as
blocking — see `CLAUDE.md` §6 — but confirm that's still true before
dismissing). If branch-introduced (e.g. this PR's diff somehow triggered a
fresh scan that a pre-existing gap only now surfaces on): add a concise
JSDoc comment to `sanitizeLogMessage`, no behavior change.

**P1 — WordCloud deselection bug**: "Clicking a different rendered word that
shares the same KG node ID clears the selection instead of selecting the new
word." Check `handleMouseClick` in `web/components/templates/console/WordCloud.tsx`:
`const newId = word ? (word.id === selectedId ? null : word.id) : null;` —
this compares `word.id` (the shared node id) against `selectedId`, NOT
`word.wordKey`. If two different words share a node id and the node is
already selected (from clicking word A), clicking word B computes
`word.id === selectedId` as true (same node id) and sets `newId = null`,
deselecting instead of switching to word B. Verify this by tracing the
actual values, then fix: the toggle-off check should compare
`lastClickedWordKeyRef.current === word.wordKey`, not `word.id === selectedId`,
so clicking a DIFFERENT word (even sharing a node id) always selects it, and
only clicking the SAME word again toggles off.

**P1 — Animation/transition timing race**: "The clicked-word highlight can
disappear intermittently... `onSelect` runs inside `startTransition`. The
next animation frame can see the old prop and classify the local click as
external." Trace this: `drawCanvas`'s selectedId-vs-lastSelfSelectedIdRef
check runs on every draw, including draws triggered by the entrance/pulse
animation loop (`requestAnimationFrame`) that happen BEFORE React commits
the `startTransition`-wrapped `selectedId` prop update. If a draw fires in
that window, does `selectedId !== lastSelfSelectedIdRef.current` (comparing
the STILL-OLD prop against the ref we just set synchronously in the click
handler) incorrectly read as "external change" and clear
`lastClickedWordKeyRef`? Verify with the actual React/startTransition
semantics (a ref write in an event handler is visible synchronously to any
code running before the next commit, but `selectedId` — a PROP — only
updates AFTER the transition commits). If confirmed, this is a real race.
Consider: what actually needs to distinguish "own click, transition
pending" from "external change" — the ref pair as currently designed may
already be correct IF `lastSelfSelectedIdRef` is what's compared (it holds
the value we WANT selectedId to become, set eagerly) rather than comparing
against something else. Read the actual current code carefully — this
finding may be a correct concern, or may already be handled by the existing
design; state which after tracing, don't assume Cubic is right.

**P1 — Stale wordKey across analysis/graph switches**: "A selected wordKey
can survive replacement of the graph or loading another analysis." Check:
is there any effect that resets `lastClickedWordKeyRef`/`lastSelfSelectedIdRef`
when `graph.rootId` changes (the same signal the existing
`wordProgressRef`/`wordStartedAtRef` reset effect at the top of the
component already uses for exactly this class of stale-state bug)? If not,
add it to that same existing reset effect (keyed on `graph?.rootId`) rather
than a new one — don't duplicate the reset mechanism.

**P2 — External same-node re-selection doesn't restore node-wide highlight**:
"A cross-panel selection of the same node ID may not restore node-wide
highlighting... The ref-clearing logic only observes value changes." If
`selectedId` is ALREADY equal to the node id (from this component's own
earlier click) and a DIFFERENT panel (e.g. KnowledgeGraphCanvas) re-selects
that same node id, `selectedId` doesn't change value, so the ref-clearing
`if (selectedId !== lastSelfSelectedIdRef.current)` check never fires, and
the stale word-specific highlight persists instead of falling back to
node-wide. This is a real but narrow edge case (same node re-selected from
elsewhere while already selected via a local click) — fix if a clean fix
exists without over-engineering (e.g. an explicit `onSelect` callback
signature change is likely NOT worth it for this edge case — consider
whether it's worth fixing at all vs. documenting as an accepted limitation;
your call, but state the reasoning either way).

**P2 — ARIA count uses node-id matching while canvas highlight uses wordKey**:
`selectedWordCount` (used in the accessible label) filters
`wordsLayout.filter((w) => w.id === selectedId)`, which will overcount
relative to what's actually highlighted on canvas once the wordKey-based
exact-highlight is active. Fix: derive the accessible count from the same
predicate the canvas uses (extract a shared `isWordSelected(word)` helper
used by both `drawCanvas` and the ARIA label computation), not two separate
predicates that can drift.

**P2, conditional — seek semantics still node-level**: "distinct words
sharing a node still call `onSelect` with the same node ID... they will
continue resolving to the same node timestamp." This is EXPECTED and
INTENTIONAL for this PR — CC has already scoped a separate, larger
architecture change (per-mention timestamps, see the new ADR being written
in parallel, `docs/specs/ADR_022_PER_MENTION_ENTITY_TIMESTAMPS_2026-08-06.md`
if it exists yet, or ask CC) that will supersede this PR's highlight-only
fix. Do NOT attempt to fix seek semantics in this PR — confirm this
understanding in your report, and note it as intentionally deferred, not a
gap in this PR's scope.

**P2 — no regression test for `setExecutiveDigest`**: add tests in
`web/lib/__tests__/` (find or create the right file — check for an existing
`useAnalysisStore.test.ts` first) covering: (1) updates `analysis.executiveDigest`
when `analysisId` matches the current analysis, (2) is a no-op when
`analysisId` doesn't match (stale response after switching analyses), (3)
is a no-op when no analysis is currently active (`state.analysis === null`).

## 3. Goal / definition of done

Every finding above resolved as VALID-and-fixed or FALSE-POSITIVE-with-evidence.
All CI checks on PR #207 green (or confirmed baseline/non-blocking per
`CLAUDE.md` §6's confidence formula — Cubic, CodeRabbit, Snyk, CI/CD
Pipeline, Vercel, CodeQL are the checks that matter; Codacy/DeepSource/
CodeFactor complexity-and-style findings have repeatedly been confirmed
non-blocking noise all session, but CONFIRM this round's specific findings
are that same class, don't assume). Once green and you've independently
verified (not just trusted CI's green checkmark) that the fixes are real —
merge the PR (squash, delete branch), matching how CC merged PR #206.

## 4. Expected results

- WordCloud.tsx: deselection bug fixed (clicking a different same-node word
  selects it, not deselects), stale-ref reset on graph/analysis switch,
  shared selection predicate for canvas+ARIA.
- Confirmed (not fixed) whether the transition-timing race is real; fixed if
  real, documented as already-handled-correctly if not.
- `useAnalysisStore.ts`/`useExecutiveDigest.ts`: doc comment on
  `sanitizeLogMessage` IF branch-introduced; new tests for
  `setExecutiveDigest`.
- history-overview.ts: Cubic found no defect there — no changes expected,
  confirm and move on.
- PR #207 merged to `main`.

## 5. Task-specific skills/tools/plugins/MCPs

CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets are
[ALWAYS INCLUDE] below. Beyond that: `react-best-practices` applies directly
(ref/effect timing, selection state design in a canvas component).
`web-design-guidelines` if any accessibility-relevant markup changes (the
ARIA-count fix touches this). No Supabase/DB work in this PR — no Supabase
MCP needed. Use `gh pr checks 207` and `gh pr view 207 --json comments` to
pull live CI/review state rather than assuming Cubic's pasted findings are
current — the PR may have moved since they were captured.

## 6. Fixtures

Run `code-review-graph`'s `build_or_update_graph_tool` then
`get_review_context_tool`/`get_impact_radius_tool` scoped to
`web/components/templates/console/WordCloud.tsx`,
`web/store/useAnalysisStore.ts`, `web/hooks/useExecutiveDigest.ts`,
`web/lib/utils/history-overview.ts` before reading full files. Start from
branch `fix/wordcloud-cluster-and-date-title` at commit `cfdb32b1` — verify
you're actually on this commit (`git log --oneline -1`) before assuming any
of the above is already fixed or not. `git fetch && git checkout
fix/wordcloud-cluster-and-date-title && git pull` if starting from a stale
local checkout.

## 7. The three tenets

> 1. **Contract definition + enforcement.** State the exact input→output
>    contract for what you're building BEFORE writing it. After writing it,
>    check the diff against that stated contract — not "does it compile,"
>    but "does this actually fire on the real path it claims to fix."
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
>    passing unit test proving a function's isolated output is correct is
>    NOT sufficient evidence the fix works — trace the real caller chain
>    with actual proof (a live DB query showing a row landed, a real HTTP
>    round-trip, not a mock standing in for the whole chain).
> 3. **Tangent hunt as you walk the workflow.** While touching each file,
>    check adjacent call sites and control-flow branches for the same class
>    of gap. Report tangents found even if not fixed this pass.
>
> **If you cannot complete a full cycle, or find a design gap mid-task,
> STOP and report the specific deviation and why, rather than shipping a
> partial fix under a "done" label.** A clearly flagged incomplete item is
> fine; a silently incomplete one reported as done is not — this project's
> history has multiple confirmed incidents of exactly that pattern.

## 8. Report format

> RCA → Contract → Fix → E2E proof (cite actual command/query output, not
> "tests pass") → Tangents found → Deviations flagged (if any) → Skills run
> + findings → Gates (tsc/vitest/qa-intel `--ci --compare`/contract-auditor
> results, exact output) → Files changed → Merge outcome (commit SHA on
> `main`, confirmed post-merge CI status). CC independently re-verifies
> every claim against real code and real system state before accepting — a
> report claiming "done" without this structure, or without E2E proof, will
> be rejected and sent back.

## 9. Gates

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' on output, empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # THE EXACT CI FLAGS — the bare default run has different exit-code behavior and will give a false pass
pnpm tsx web/scripts/contract-auditor.ts
```

Also required before merge: `gh pr checks 207` showing green (or confirmed
non-blocking) on the CLAUDE.md §6 confidence-formula checks.
