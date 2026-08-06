# OC Prompt — ADR 023: Reliable Client-Side Knowledge Graph Fallback

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — read it now
if you haven't already. Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md`
before touching any file; post `[IN_PROGRESS]` with intent + target files as
your first action; re-check the ledger after every subtask; post
`[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually
happened (not what you intended) as your last action.

## 1. Context

Read `docs/specs/ADR_023_CLIENT_SIDE_KNOWLEDGE_GRAPH_REGENERATION_2026-08-06.md`
in full FIRST — it has the complete origin, the live-DB evidence (real
query + real results), and the exact scope boundary. This prompt summarizes
it but the ADR is the source of truth.

One-paragraph summary: a live production bug report ("all dims present but
no knowledge-graph panels showing") was traced via a live Supabase query
(project `adnmbikaqnxivalqoild`) to TWO distinct real data states: some
complete analyses have a graph in `analysis_payload->knowledgeGraph` but
nothing in the separate `kg_entities`/`kg_relations` tables (and
`kg_relations` is confirmed EMPTY across the entire database); some
analyses have NEITHER — no knowledge graph data anywhere. For that second
group, `web/hooks/useKnowledgeGraph.ts`'s client-side TF-IDF fallback
synthesis (built from dimension text, which is always present) is the only
possible source of a displayed graph. A confirmed real repro case: analysis
id `960a99dd-3f60-40c5-aea0-a899c39cba8d` ("Let's build GPT: from scratch,
in code, spelled out.", `dimension_count = 11`, both `payload_kg_node_count`
and `kg_entities_row_count` are 0).

## 2. Task

**2a. Reproduce and confirm.** Load analysis `960a99dd-3f60-40c5-aea0-a899c39cba8d`
in the live app (via the history restore flow, `AnalysisHistory.tsx`'s
`restoreAnalysis`) and observe: does the knowledge graph panel (WordCloud/
KnowledgeGraphCanvas/MindMap/IntelligencePanel, all fed by
`DashboardContainer.tsx`'s `useKnowledgeGraph(nucleusAnalysis?.id)`) show
anything on first render, or does it require an unrelated interaction
(switching persona, resizing, any other state change) before it appears?
If you cannot reproduce it live (no browser access), trace the exact effect
execution order by hand instead — read `web/hooks/useKnowledgeGraph.ts` in
full (both effects, all dependency arrays) and `web/components/templates/console/AnalysisHistory.tsx`'s
`restoreAnalysis` (~line 290-370, the `startTransition` block that calls
`initializeAnalysis`/`initSynthesis`/`setKnowledgeGraph`/`setStatus` in
sequence) — determine precisely which effect SHOULD fire first, with what
dependency values, and whether anything could cause the client-fallback
effect (`useKnowledgeGraph.ts`'s second `useEffect`, the one with
`[fingerprint, dimensions, activePersona, analysisId, apiFetchDone, loadedFromApi, storeKnowledgeGraph]`
as deps) to either not fire, or fire with `dimensions.length < 1` on its
first pass and never retry.

**2b. Root-cause and fix.** Once confirmed (not assumed), fix the actual
defect. Candidate mechanisms to check specifically (don't assume any one
without verifying against the real code):
- Does `dimensions` (the `useMemo` in `useKnowledgeGraph.ts` deriving from
  `analysis.dimensions`) compute correctly and promptly from a RESTORED
  analysis, or is there a render-order gap where `analysis` is briefly
  `null`/incomplete when this hook first evaluates, causing `dimensions.length < 1`,
  which sets `lastFingerprint.current = ''` — does the effect actually
  re-run and retry once `analysis` populates, or does something prevent
  that?
- Does the API-fetch effect (`useKnowledgeGraph.ts`'s FIRST `useEffect`,
  keyed on `analysisId` alone) reliably set `apiFetchDone = true` for an
  analysis with zero `kg_entities` rows (i.e. does the fetch to
  `/api/analyses/[id]/graph` actually resolve with an empty-but-successful
  response, or could it be erroring/hanging in a way that leaves
  `apiFetchDone` stuck `false` — which would permanently block the
  client-fallback branch via the `if (analysisId) { if (!apiFetchDone) return; ... }`
  guard)? Check `web/app/api/analyses/[id]/graph/route.ts` directly.
- Is there a StrictMode-double-invoke or effect-ordering interaction
  similar to the `useChapters.ts` self-cancellation bug found earlier this
  session (see `docs/history/THOS_2026-08-06_0152_CHAPTERS_FEATURE_AND_DECOUPLING.md`
  for that RCA as a reference pattern, not because it's necessarily the
  same bug).

**2c. Smaller audit (in scope, don't skip)**: given `kg_relations` is
confirmed empty database-wide and `kg_entities` is inconsistently
populated even for `dimension_count = 11` rows, is
`/api/analyses/[id]/graph` (the effect-1 API-fetch path) still worth being
the FIRST-checked source in `useKnowledgeGraph.ts`'s priority order, ahead
of the payload-embedded graph? Don't change persistence write behavior
(don't start writing to `kg_entities`/`kg_relations` differently — that's
explicitly out of scope, see the ADR) — this is only about whether the
CLIENT read-priority order still makes sense given how unreliable that
table has turned out to be in practice. State a recommendation, implement
only if it's a small, clearly-justified reordering; otherwise report the
finding without changing it.

**2d. Manual regenerate action — only if 2b's investigation finds a
structural reason the automatic fallback can't be made fully reliable.**
Per the ADR, this is optional and needs a clean before/after case for why
automatic-fix wasn't sufficient — don't build it as a default just because
it's mentioned as a possibility.

## 3. Goal / definition of done

Analysis `960a99dd-3f60-40c5-aea0-a899c39cba8d` (and the same class of
analysis generally — no persisted KG data anywhere) reliably shows a
client-side-synthesized knowledge graph on first restore, with real
verification (a live repro showing the fix working, or if no browser
access, a traced proof of the corrected effect execution order plus a new
test case if the bug was in testable pure logic).

## 4. Expected results

- Root cause of the fallback-doesn't-reliably-fire behavior stated with
  evidence (not assumed from the ADR's candidate list — confirm which one,
  or find a different one).
- Fix applied to `useKnowledgeGraph.ts` (or wherever the actual defect
  lives — don't assume it's in that file without checking).
- A stated recommendation (implemented or not, per §2c's own scoping) on
  the API-fetch-path read-priority question.
- No changes to `kg_entities`/`kg_relations` write/persistence behavior.
- No video/audio processing added.

## 5. Task-specific skills/tools/plugins/MCPs

CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets are
[ALWAYS INCLUDE] below. Beyond that: `react-best-practices` applies
directly (effect dependency/timing analysis is the whole task). Supabase
MCP (`execute_sql`, project id `adnmbikaqnxivalqoild`) if you need to
re-verify the live data state or check `/api/analyses/[id]/graph`'s actual
query behavior against real rows — wrap any exploratory query in
`BEGIN...ROLLBACK` per this project's established pattern (though a plain
`SELECT` needs no transaction wrapper; only wrap if you're testing
anything that writes).

## 6. Fixtures

Run `code-review-graph`'s `build_or_update_graph_tool` then
`get_review_context_tool`/`get_impact_radius_tool` scoped to
`web/hooks/useKnowledgeGraph.ts`,
`web/components/templates/console/AnalysisHistory.tsx`,
`web/app/api/analyses/[id]/graph/route.ts`,
`web/components/containers/DashboardContainer.tsx` before reading full
files. Start from `main` at its current HEAD (`git log --oneline -1`) —
verify PR #208 (ADR 022) is present before assuming a clean baseline.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State exactly what "the fallback
   works reliably" means as a testable condition before writing the fix,
   then verify the diff actually produces that condition on the real repro
   case.
2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
   theory about which effect fires when is NOT sufficient evidence without
   either a live repro or a fully hand-traced execution order with actual
   values at each step (not "should be X", but "IS X, confirmed by reading
   the exact code path with the exact repro analysis's real data").
3. **Tangent hunt.** While in `useKnowledgeGraph.ts`, check whether the
   SAME class of "fallback effect doesn't reliably retry" issue could
   affect any of the hook's other branches (e.g. what happens if
   `analysisId` changes mid-fetch — is there a stale-closure risk there
   too). Report tangents found even if not fixed this pass.

**If you cannot complete a full cycle or find a design gap, STOP and
report the specific deviation and why.**

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (actual command/query output, or a fully
traced execution order with real values — not "tests pass") → Tangents
found → Deviations flagged → Skills run + findings → Gates → Files changed.
CC independently re-verifies every claim against real code and real system
state before accepting.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' — empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # EXACT CI flags, not the bare default run
pnpm tsx web/scripts/contract-auditor.ts
```
