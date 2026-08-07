# Agent Dispatch — Retrospective review of merged PRs 208-214

This file covers 6 parallel agent dispatches (grouped, one PR pair combined)
reviewing already-MERGED code on `main` for lingering issues. Every agent
below shares the sections in Part A (ledger protocol, three tenets, report
format, gates) — apply them exactly as written, they are not optional.
Part B has your specific group's Context/Task/Goal — find your group by the
PR number(s) you were told to review.

## Part A — shared, applies to every group [ALWAYS INCLUDE]

### 0. Ledger protocol

Follow `CLAUDE.md` §2 "SHARED COMMUNICATION PROTOCOL" in full. Read
`.memory/AGENT_LEDGER.md` before touching any file. Post `[IN_PROGRESS]` with
intent + target files (name the PR number(s) you're reviewing) as your first
action. Post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary as your
last action.

### Overall context

This is a RETROSPECTIVE quality pass, not a live PR review — these PRs are
already merged to `main`. The user explicitly asked: "run a similar exercise
[to the /simplify pass just done on PR #216] for the previous PRs using
/code-reviewer /verify and /simplify and see if we come up with anything —
you can also choose any other skills like /vercel-react-best-practices or
/supabase-postgres-best-practices, etc." "Verify" here means actually
running the real gates (tsc, vitest, qa-intel `--ci --compare`,
contract-auditor) against current `main` HEAD scoped to the PR's files, not
a skill named literally `/verify`.

### The three tenets

1. **Contract definition + enforcement.** For a review task, this means:
   state what the PR's code claims to guarantee (from its own comments/tests)
   before checking whether the current code on `main` still honors that.
2. **E2E cycle complete, input to output, across the ENTIRE chain.** Don't
   just re-read the diff — trace whether the fix this PR shipped is still
   actually wired into the real call path on current `main` (something later
   could have silently regressed or bypassed it).
3. **Tangent hunt as you walk the workflow.** While reviewing your assigned
   files, check adjacent call sites/files for the same class of issue found.
   Report tangents found even if not fixed this pass.

If you find a real, non-trivial issue: fix it directly on a new branch off
current `main`, verify with real gates, and open a PR (branch prefix
`fix/retro-review-`, do not merge yourself). If you find only minor/cosmetic
issues or nothing, do NOT open a PR — report findings only (skipped, with
why) per the report format below. Do not manufacture busywork.

### Report format

RCA/Findings → Contract (what was claimed vs. what's true now) → Fix (if any)
→ E2E proof (if any fix) → Tangents found → Skills run + findings → Gates
(exact output, if a fix was made) → Files changed (if any) → PR link (if any).

### Gates (only if you make a fix)

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' on output, empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
```

### Fixtures [ALWAYS INCLUDE]

Before touching any code, run this project's `code-review-graph` MCP tools
(`build_or_update_graph_tool` first, then `get_review_context_tool`/
`get_impact_radius_tool` scoped to your assigned files) — CLAUDE.md mandates
this as Step 0, before Grep/Glob/Read.

---

## Part B — per-group Context/Task/Goal

### Group 1 — PR #208 (`feat/entity-time-seek`, ADR 022 per-mention resolution)

**Files**: `web/components/TimestampLink.tsx`, `web/components/containers/DashboardContainer.tsx`,
`web/components/templates/console/VideoPlayerCard.tsx`, `web/lib/utils/entity-time-seek.ts`,
`web/lib/adapters/YouTubePlayerAdapter.ts`, `web/lib/ports/VideoPlayerPort.ts`,
`web/store/useVideoStore.ts`, `web/lib/__tests__/entity-time-seek.test.ts`.

**Context**: This PR shipped the core entity-click seek feature — resolving
which mention of an entity to seek to when a user clicks it, replacing a
naive "always first occurrence" bug. It's the same subsystem this session
found TWO further real bugs in (PR #217's `raw_node.dimension` loss, and a
separate `VideoPlayerCard.tsx` facade/interacted-state mechanism this
session read closely). Given that history, this is a high-value target for
a genuine correctness re-review, not just style.

**Task/Goal**: Run `/code-reviewer` (correctness/maintainability/security
pass) and `/simplify` (reuse/simplification/efficiency/altitude) against
`git show 208-merge-commit` or `gh pr diff 208`'s actual changed lines,
evaluated against CURRENT `main` (the files have likely changed since — read
current state, not the historical diff, for anything you'd fix). Also run
`react-best-practices` skill (rerender-/client- rule categories especially,
given this is hook/component state machinery) since this is exactly the
class of file it targets. Look specifically for: state-sync bugs between
`useVideoStore` and the YouTube adapter, effect-dependency gaps, and
anything resembling the interacted-state/facade mechanism gap already found
in `VideoPlayerCard.tsx` this session (a click-before-mount / remount class
of issue) that might recur elsewhere in this file set.

### Group 2 — PR #209 + PR #213 (knowledge-graph fallback + entity-seek playhead fix)

**Files (209)**: `web/hooks/useKnowledgeGraph.ts`. **Files (213)**:
`web/lib/utils/entity-time-seek.ts`, `web/lib/__tests__/entity-time-seek.test.ts`.

**Context**: 209 was ADR 023's client-side KG fallback reliability fix; 213
was a null-playhead fallback fix (falls back to last mention, not first).
Both are in files THIS SESSION found more bugs in later (`useKnowledgeGraph.ts`
had the `raw_node.dimension` bug fixed in PR #217; `entity-time-seek.ts` had
a "reduce by seekSeconds" ordering fix from an earlier Cubic finding per
memory). Check whether these two small, earlier fixes are still intact and
correctly composed with the LATER fixes that landed on top of them (do they
conflict, double-handle, or leave a gap between them?).

**Task/Goal**: `/code-reviewer` + `/simplify` on current `main` state of
both files (not the historical diffs — read what's actually there NOW,
since PR #217 already modified `useKnowledgeGraph.ts` after this). Tangent
hunt specifically for: does the ADR 023 fallback and the PR #217
`raw_node.dimension` fix compose correctly, or does one undermine the
other's assumption?

### Group 3 — PR #210 (telemetry / SILENT_ERROR_RETURN_NO_TELEMETRY fixes)

**Files**: `web/app/api/webhooks/upstash-snapshot-poll/route.ts`, `web/lib/api-client.ts`.

**Context**: Fixed 12 contract-auditor findings where a failure return had
no telemetry. Verify these are STILL correctly telemetried on current
`main` (a later edit could have silently removed a Sentry call), and that
the fix pattern used matches the CORRECT pattern (not just "silences the
finding" — actually captures useful context, matching the
`SecretsExposureRule` constraint of never leaking tokens/keys into
Sentry `extra`/`contexts`).

**Task/Goal**: `/code-reviewer` (correctness/security lens — specifically
check no secrets/tokens leak into the added Sentry calls) + `owasp-top-10`
skill (this touches a webhook route — verify signature/auth validation is
still intact, not just the telemetry addition) + `/simplify`.

### Group 4 — PR #211 (16 UNVERIFIED_ENDPOINT_NO_TEST contract-auditor findings)

**Files**: `web/app/api/admin/logs/qstash/route.ts` (+test), `web/app/api/admin/logs/supabase/route.ts` (+test),
`web/lib/adapters/OpenRouterCompletionAdapter.test.ts`, `web/lib/admin-logs/fetchers.ts` (+test),
`web/lib/embeddings.ts` (+test), `web/lib/env.ts` (+test), `web/lib/intelligence/relations-engine.test.ts`,
`web/lib/services/dimension-remediation.ts` (+test), `web/lib/services/openrouter.test.ts`,
`worker/src/chat-stream.ts` (+test), `worker/src/services/CommentClassifier.test.ts`,
`worker/src/services/LLMCascade.test.ts`, `web/vitest.config.ts`.

**Context**: This is the largest of the 7 — added real test coverage across
14+ files including two admin log ADMIN-ONLY API routes. This is exactly
the kind of PR where `owasp-top-10`'s Broken Access Control category matters
(admin routes) and where `/code-reviewer`'s "Testability" pillar applies
literally (are the ADDED tests actually testing real behavior, or just
asserting mocks were called — the same shallow-test anti-pattern this
session found and fixed in `useKnowledgeGraph.test.tsx` earlier today).

**Task/Goal**: `/code-reviewer` on the two admin route files specifically
for auth/access-control correctness (`owasp-top-10`'s Broken Access Control
reference file). `/simplify` on the full file set. Also spot-check 3-4 of
the newly added `.test.ts` files (your choice, sample don't read all 14) for
the "test asserts shape only, not real behavior" anti-pattern.

### Group 5 — PR #212 (ADR 024 happy-dom + RTL test infra, 4 regression tests)

**Files**: `web/components/templates/console/__tests__/WordCloud.test.tsx`,
`web/hooks/__tests__/useChapters.test.tsx`, `web/hooks/__tests__/useExecutiveDigest.test.tsx`,
`web/hooks/__tests__/useKnowledgeGraph.test.tsx`, `web/vitest.config.ts`,
`web/vitest.dom-setup.ts`, `web/package.json`.

**Context**: `useKnowledgeGraph.test.tsx` from this PR was later extended
TWICE more this session (PR #217's dimension regression test, and just now
this session's raw_node preservation test). Verify all 3 layers of tests in
that one file are non-overlapping/non-contradictory and the file as a whole
on current `main` is coherent, not just individually-correct fragments
bolted on 3 times by 3 different passes.

**Task/Goal**: `/code-reviewer` (read `useKnowledgeGraph.test.tsx` on
current `main` HEAD in full) + `/simplify`. Check `vitest.config.ts`/
`vitest.dom-setup.ts` for anything that could mask a real failure (e.g. an
overly broad error suppression, a global mock that's too permissive).

### Group 6 — PR #214 (chip-state-sync unification)

**Files**: `web/components/templates/console/AnalysisHistory.tsx`,
`web/hooks/useAutoRestoreAnalysis.ts`, `web/hooks/useAuxElementStatus.ts`,
`web/hooks/useSSEStream.ts`, `web/lib/stores/analysis-metadata-store.ts`,
`web/lib/stores/synthesis-nucleus-store.ts`, `web/lib/types/synthesis-nucleus.ts`.

**Context**: This was the original chip-mismatch bug fix from earlier this
session (history chips not matching synth console chips) — a Cubic
multi-round PR per the session history. Given the volume of Cubic rounds
this PR went through, check whether all those fixes actually landed
coherently on current `main`, or whether any got partially reverted/
conflicted by a later merge.

**Task/Goal**: `/code-reviewer` + `/simplify` + `react-best-practices`
(this is exactly rerender-/derived-state- territory: chip status derived
from multiple stores). Tangent hunt: any OTHER chip-rendering call site in
the codebase using a different derivation path than
`useAuxElementStatus.ts` (the canonical one per this PR) that might have
been missed and still shows stale/inconsistent chips.
