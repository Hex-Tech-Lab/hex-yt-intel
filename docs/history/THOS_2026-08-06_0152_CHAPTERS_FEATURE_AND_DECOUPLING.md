# TECHNICAL HANDOVER SUMMARY — hex-yt-intel: Chapters Feature, PR #205→#206, Agent-Protocol Infrastructure

**Session Date**: 2026-08-04 → 2026-08-06 (multi-day, spans a laptop shutdown/resume and a background remote-agent run)
**Agents Involved**: Claude Code / CC (Sonnet 5, orchestrator + verifier, this session), OC (opencode/DeepSeek v4 Flash, execution), AGY (Antigravity/Gemini, one UI batch), a remote background Agent-tool instance (RPC-grants verification + range-timestamp fix)
**Project**: hex-yt-intel — YouTube video analysis platform (Next.js 16/Turbopack on Vercel + Cloudflare Worker + Supabase Postgres)
**Session Type**: Feature development (chapter extraction + timestamp-anchored entity seeking) → multi-round adversarial code review → architecture decoupling → agent-dispatch process hardening
**Status**: PR #205 (chapters feature) MERGED to main. PR #206 (decoupling follow-up) OPEN, 2 confirmed P0s just fixed, review still in progress (Cubic/Qodo/CodeRabbit). Live production bug report just received (separate from PR #206), not yet investigated.

---

## Executive Summary

Built end-to-end chapter extraction (YouTube description → parsed timestamps → DB → UI chip → entity-click seek-to-chapter) across ~15 review-fix cycles on PR #205, merged it, then architected and partially implemented a follow-up (PR #206) to decouple chapter persistence from the analysis request lifecycle per an explicit user design critique. The single biggest recurring failure mode this entire session: **every agent's "done" report was clean on unit-level gates (tsc/vitest/qa-intel) while broken on the real end-to-end chain** — found independently by CC on nearly every round, including twice in the last hour on PR #206 (a P0-severity self-cancelling React effect that made the entire chapters feature non-functional, found by hand-tracing Zustand's actual reference-identity semantics, not by trusting the review tool that flagged it). Immediate next action: verify a live-prod bug report just received (knowledge-graph panels empty for one persona but not another; entity-seek clustering badly) — status unknown, not yet triaged, likely unrelated to the chapters work.

---

## Technical Environment

- **Monorepo**: pnpm workspace (root `pnpm-workspace.yaml`, NOT root `package.json`, is where pnpm 11 reads `overrides:`)
- **Node**: 24.16.0 · **TypeScript**: 6.0.3 strict · **pnpm**: 11.9.0 · **ESM** throughout
- **Web**: Next.js 16 (Turbopack), React 19, Tailwind v4, Zustand for client state, `@astryxdesign/core`/`theme-neutral` (frozen UI stack, NOT shadcn — deleted repo-wide 2026-08-02)
- **Worker**: Cloudflare Worker, Hono framework, esbuild bundling, `wrangler` CLI
- **DB**: Supabase Postgres, project ref `adnmbikaqnxivalqoild` (matches `NEXT_PUBLIC_SUPABASE_URL`). Migrations in `supabase/migrations/`, CI-automated `supabase db push` on merge to main (ADR 013) — **filename must match Supabase's own recorded version exactly** (ADR 018, `apply_migration` auto-timestamps server-side).
- **Test runner**: Vitest. **Critical, pre-existing, session-discovered gap**: `web/vitest.config.ts`'s `include` glob is `['lib/__tests__/**/*.test.ts', '../worker/src/__tests__/**/*.test.ts']` — matches neither `.tsx` files nor anything outside `lib/__tests__`. This project also has **no jsdom/happy-dom dependency installed at all**. Two `.tsx` component tests (`TimestampLink.test.tsx`, a newly-added `SignalBarGroup.test.tsx`) were silently dead as a result — discovered and worked around (not root-fixed; the config gap itself is still open) by extracting pure logic into DOM-free `.ts` tests instead.
- **Branches (active, this session)**:
  - `main` — has PR #205 merged (commit range ending `9a9c8aa5`)
  - `feat/chapters-decoupling` — PR #206, currently at commit `782d2b17`, open, under review
  - Multiple stale local worktrees exist from earlier agent dispatches (`.claude/worktrees/agent-*`) — several contain uncommitted or orphaned work from mid-session worktree/branch-mismatch incidents (see Troubleshooting Loops below). Not cleaned up as of this handover.
- **Uncommitted state at handover time**: working tree on `feat/chapters-decoupling` should be clean (last action was a commit+push of `782d2b17`) — verify with `git status` before continuing, don't assume.
- **Multi-agent setup**: OC and AGY both operate in the **same shared local checkout** as CC by default (not isolated worktrees) unless explicitly dispatched via the `Agent` tool with `isolation: "worktree"` or `"remote"`. This caused at least one real file-mixing incident this session (files from OC's chapters-decoupling work appeared uncommitted in CC's own working tree mid-task, see below).

---

## Chronological Timeline (newest first)

### 2026-08-06, ~01:47 — 🔑 KEY FIX: useChapters self-cancellation race (P0, just landed)
Cubic's PR #206 review flagged two P0s in `web/hooks/useChapters.ts`. CC did NOT trust the review text — hand-traced actual React+Zustand render/effect semantics to confirm:
- `useChaptersStore()` called with no selector subscribes to the whole store; Zustand's `set()` produces a new top-level object reference on every call, including the hook's own `setLoading()` call made inside its own effect.
- That changed the effect's dependency array (`[videoId, entry.status, store]`), React re-ran the effect, cleanup fired (`cancelled=true`) on the fetch that had started one tick earlier, and the second effect pass short-circuited on `status==='loading'`. Net result: **the feature was functionally dead on essentially every mount** — fetch result silently discarded, chapters permanently stuck at `status: 'loading'`.
- Separately, `'error'` status was never in the early-return guard, so exhausting all 5 retries triggered `setError()`, which (same mechanism) re-ran the effect and restarted the whole retry cycle — infinite loop.
- **Fix** (committed `782d2b17`): decoupled "has this hook instance handled this videoId" from the reactive store subscription — a plain `useRef`, not a dependency-array value. Store actions read via narrow selectors (`useChaptersStore((state) => state.setLoading)`), which are stable references in Zustand. Effect deps reduced to `[videoId, setLoading, setLoaded, setError]` (all stable except `videoId`).
- Verified: tsc clean, vitest 63/63 files 1025/1025, qa-intel `--ci --compare` clean. **NOT YET covered by a dedicated unit test for this specific race** — flagged as a gap, see Critical Path Forward.

### 2026-08-06, ~01:35–01:47 — Independent re-verification of OC's PR #206 implementation, found + fixed 2 more real regressions
Before the Cubic P0 above, CC independently re-verified OC's "done" report on the chapters-decoupling implementation (per this session's standing rule: a report is not evidence). Found:
1. **`attemptedButEmpty` condition inverted** in the new `POST /api/videos/[videoId]/chapters` — `chapterRows.length === 0 && rawChapters.length > 0` is true exactly when every submitted chapter is malformed, triggering a sentinel write that **deletes existing valid chapters** (reintroducing a P0 bug already fixed once on the OLD code path, not carried forward into the freshly-written endpoint). Also false for a genuinely-empty parse, meaning the orange "attempted, empty" sentinel could never be written for real empty-description videos via this endpoint.
2. **Race in the read path**: `getChapters()` can't distinguish "confirmed empty via sentinel" from "nothing written yet" — both return `[]`. Since the new write path fires fire-and-forget from inside the SSE stream handler, a fast client GET can legitimately race ahead of it. Fixed by adding `getChaptersWithStatus()` (adapter method reporting `confirmed: boolean`) and updating the GET route + hook to treat `confirmed: false` as not-yet-final (keep retrying), not a final empty result.
- Both fixes verified via **live rolled-back DB transactions** against the real Supabase schema (3 read states: never-attempted / confirmed-real / confirmed-empty-sentinel; write-side: malformed-submission-leaves-existing-data-untouched). Committed as `b0c34edf`.
- Also fixed 2 new qa-intel findings the original OC commit introduced (unclear single-letter var names, missing `finally` block) — CI's `--ci --compare` gate fails on ANY new finding regardless of severity, unlike the bare default `verify-quality-engine.ts` run.

### 2026-08-06, ~01:15–01:35 — 🔑 KEY DECISION: mandatory agent-dispatch prompt template created
**Trigger**: OC only posted its `[IN_PROGRESS]` ledger entry for the chapters-decoupling task AFTER the user manually told it to follow protocol — the dispatched prompt itself never explicitly restated the ledger protocol (even though it's documented in full in `AGENTS.md` §5 and at the top of `.memory/AGENT_LEDGER.md`). A prose reminder living in `CLAUDE.md` alone (added 2026-08-03 after a similar gap) still wasn't reliably making it into every actually-dispatched prompt.
**Decision**: stop relying on memory/prose reminders; created `docs/agent-prompts/TEMPLATE.md`, a literal copy-and-fill template with `[ALWAYS INCLUDE]` sections (ledger protocol — references `AGENTS.md` §5 as canonical rather than duplicating, to avoid drift; code-review-graph as mandatory Step 0; the three verification tenets; required gates; report format) and `[FILL IN]` sections (Context/Task/Goal/Expected results/task-specific skills-tools-MCPs/task-specific fixtures).
**Artifacts**: `docs/agent-prompts/TEMPLATE.md`, `CLAUDE.md` (§"Mandatory template..." now points to the file instead of restating 6 prose bullets), `AGENTS.md` (§5 gets a one-line pointer back to the template), a durable memory (`feedback_agent_prompt_template_mandatory`, saved outside the repo at `~/.claude/projects/.../memory/`).
**Committed**: `d9eece0a`.
**Why this matters**: every prior "mandatory sections" reminder in this session's history was prose living in a doc the dispatching agent (CC) was supposed to remember to consult — this converts it into a mechanical copy-fill-dispatch step, matching this project's own stated principle that "a rule enforced by a file/mechanism doesn't drift; a rule recalled from memory does."

### 2026-08-06, ~00:30–01:15 — PR #206 opened: chapters decoupling, initial implementation by OC
Design doc approved (3 open questions resolved by user sign-off: reuse existing HMAC machinery scoped to `{videoId, exp}`; Zustand store not local hook cache; no description-diff invalidation — re-analysis's idempotent re-write IS the invalidation). OC implementation: new `POST+GET /api/videos/[videoId]/chapters` (HMAC-signed with new `BoundSigPurpose: 'chapters'`), worker fires `parseChapters` + POST via `c.executionCtx.waitUntil(...)` before `buildStreamResponse` (non-blocking, parallel to LLM stream), new `useChaptersStore` (Zustand), `useChapters` hook refactored to a thin selector with exponential backoff. Old safety-net write in `/api/analyses/persist` **deliberately left in place** (both paths active during transition) per the design doc's explicit migration-path guidance — correctly NOT prematurely removed. OC's actual task duration: 19m43s. **CC's initial fallback check-in cadence (25min) was too loose relative to this** — user feedback, recalibrated to ~12min for subsequent checks.

### 2026-08-06, ~00:00–00:30 — PR #205 (chapters feature) merged to main; PR #206 branch + template created
PR #205 merged after Cubic passed cleanly (7m45s, first clean pass after ~6 rounds of real fixes — see Iterative Development Tracking below). New branch `feat/chapters-decoupling` created off `main`. Design doc for the decoupling (`docs/specs/CHAPTERS_DECOUPLING_DESIGN_2026-08-06.md`) written by CC in response to a direct user architecture question (see Knowledge Cycles below), 3 open questions answered by user, doc updated with approved answers, OC execution prompt written and dispatched.

### 2026-08-05, evening — 💡 BREAKTHROUGH troubleshooting: laptop shutdown mid-session, remote agent handoff
User needed to shut down mid-review-cycle. CC redacted an exposed (already-rotated) HMAC secret literal from a committed report file, committed all in-progress local fixes, and launched a **remote-isolated Agent** (cloud execution, survives laptop shutdown) with a fully self-contained prompt covering: verify whether SECURITY DEFINER RPC grants were a real problem (they were NOT — the remote agent proved this via a live `information_schema.routine_privileges` query showing `service_role` already has implicit EXECUTE despite no explicit grant, matching the existing working pattern for sibling functions), fix a real range-timestamp proximity bug in `entity-time-seek.ts` (confirmed and fixed), and re-check a list of items possibly already fixed in newer commits it wouldn't see in its initial context. Remote agent ran ~8 hours wall-clock (mostly idle/queued), pushed 2 real commits, self-terminated early citing reasoning-effort budget before completing item 3 (input validation) — CC picked that up manually on resume.

### 2026-08-05, afternoon/evening — Iterative review cycle on PR #205 (5–6+ rounds — 🔑 KEY ITERATION SEQUENCE)
This is the single largest knowledge-cycle of the session. Rounds, condensed (each round = a full review pass from Cubic/CodeRabbit/Qodo/user-live-testing, then CC verify-and-fix):
1. **Round 1** — 4 "P0" regressions claimed by review (chunked persist never fires, stale-chapter-clear on re-analysis, purge-cron never wired, entity-seek chapter-priority ordering). OC fix dispatched via a corrected prompt (baking in the "three tenets": contract, E2E-not-just-unit, tangent-hunt). OC reported all 4 fixed.
2. **Round 2 (CC verification of round 1)** — CC independently traced the ACTUAL control flow (not the report) and found: 3 of 4 genuinely fixed; the 4th (chunked persist placement) was structurally correct for the happy path but not for interrupted/partial analyses — **because chapters are chunk-independent data (same value on every chunk request) but the write was still gated behind full-chunk-receipt.** Real design gap, not a simple bug.
3. **Round 3** — Cubic (running independently, without seeing CC's round 2 finding) flagged the SAME root issue plus new ones: TTL/expiry not filtered on reads, archived-video-ID mismatch between write and read paths, chapter-parser accepts malformed timestamps (`0:60`), final chapter's implicit end capped at a naive `+60s`, `write_real_chapters`' stale-row cleanup assumed contiguous indexes (broke on sparse submissions). CC fixed ALL of these directly (not re-dispatched) — final chapter's end changed to `Number.MAX_SAFE_INTEGER` (open-ended, correct since no video-duration data exists to bound it); sparse-index cleanup changed from `idx >= v_count` to `idx NOT IN (submitted set)`.
4. **Round 4** — CodeRabbit + a second Cubic pass found: a request where EVERY chapter is malformed is indistinguishable from a genuinely-empty parse, both triggering the delete-real-chapters sentinel path (real P0, fixed with 3-state branching); a Postgres-specific gotcha where `trim()` (unlike JS) doesn't strip tabs/newlines, letting a whitespace-only label pass a "nonblank" CHECK constraint; `'Infinity'::double precision > 60` evaluates TRUE, so the DB CHECK constraint's `end_seconds > start_seconds` alone didn't exclude Infinity despite promising "finite" — both confirmed via **live Postgres queries** before fixing, not assumed from general SQL knowledge.
5. **Round 5** — qa-intel's `SchemaContractRule` flagged a `.refine()` on the new Zod chapters schema as "critical" (same rule class that caught a real production bug once before — `totalChunks` 400-cascade). CC did NOT dismiss it — wrote an isolated Zod test script to empirically prove the field was genuinely optional despite the flag, then diagnosed the rule's actual AST blind spot (`.refine()` nested inside `z.array().optional()` is invisible to the rule's upward-walk because the immediate parent is an argument-list, not a property-access chain) and restructured the code around it (moved the cross-field check to a manual post-parse filter) rather than fighting a CI gate that fails on ANY new finding. **This became a permanent qa-intel ledger entry** (`docs/qa-intel/RULESET_LESSONS_LEDGER.md`) documenting the rule gap for future reference.
6. **Round 6 (final)** — Cubic passed clean (7m45s). Merged.

**🔑 Differential insight that made round 3→4 possible**: recognizing that chapters are *chunk-independent* (parsed once from a static description field, not incrementally built from streaming LLM output) was the key unlock that reframed "why does chunked persistence keep having placement bugs" from "find the right line number" into "this data doesn't belong in the chunked-request lifecycle at all" — which directly led to the PR #206 decoupling work.

### 2026-08-05, morning — Live-test batch triage (17 items across UI, backend, logging)
User provided a large batch of live-test findings across 7 screenshots. CC classified into UI (→ AGY) vs backend/logic (→ OC) vs investigation-only (CC itself), dispatched two parallel background investigation agents for Supabase-logs performance/usefulness and a full session-log correlation sweep (Sentry + Supabase + timestamps). The log-correlation agent's finding (`HEX-YT-INTEL-3M`/`2Z`/`3X` Sentry issues suggesting a channel-metadata-timeout → persist-validation-failure chain) was later **independently disproven** by CC directly querying YouTube's own oEmbed API — the "bug" (a video titled literally "April 28, 2026") was a real creator-chosen title, not a data-pipeline defect. Correctly reversed course rather than defending the earlier hypothesis.

---

## Iterative Development Tracking — Chapters Feature (5–6+ rounds, see Chronological Timeline for full detail)

- **Final outcome**: PR #205 merged, chapters extraction + 3-state UI chip + entity-seek chapter-priority all live on `main`.
- **🔑 Key differential**: the chunk-independence insight (chapters don't belong gated behind chunk completion at all) — this single realization is what turned a bug-whack-a-mole cycle into an architecture decision (PR #206).
- **Breakthrough code** (the final-chapter open-ended fix, `worker/src/services/chapter-parser.ts`):
  ```ts
  // Before: current.end_seconds = next ? next.start_seconds : current.start_seconds + 60;
  // After (no video-duration data exists to bound the last chapter correctly):
  current.end_seconds = next ? next.start_seconds : Number.MAX_SAFE_INTEGER;
  ```

## Troubleshooting Loop Documentation

### Loop 1: Vitest include-glob + missing jsdom (discovered, worked around, root cause NOT fixed)
- **Root cause category**: test-infrastructure gap, pre-existing, unrelated to any single PR.
- **Cycle count**: 1 discovery cycle (~15 min) once a new `.tsx` test file was added and silently reported 0 tests found.
- **Stop-and-think moment**: vitest run showed 62 files passing both before and after adding a new test file — CC noticed the count didn't change and investigated instead of assuming success.
- **Verification gap it closed**: an agent's "62/62 tests passing" claim would have been literally true and completely misleading (the new test file was never executed).
- **Breakthrough insight**: checking `web/vitest.config.ts`'s actual `include` array directly, then testing whether an EXISTING `.tsx` test (`TimestampLink.test.tsx`) also silently failed to run — confirming this wasn't new-file-specific but a repo-wide gap, AND that jsdom isn't even installed (so fixing the glob alone wouldn't have been sufficient).
- **Prevention measure taken**: extracted pure logic (`clampSignalScore`) into a separate `.ts` file outside the component, tested via a DOM-free pure-function test matching the rest of this repo's actual working test convention. **Root gap (glob + missing jsdom) still open** — flagged, not fixed, out of scope for the PR that surfaced it.

### Loop 2: Worktree/branch mismatches breaking 2 of 3 parallel agent dispatches
- **Root cause category**: Agent-tool `isolation: "worktree"` creates a NEW branch per worktree, not a checkout of the target branch — agents dispatched expecting to work directly on `feat/chapters-decoupling` instead found themselves on stale `worktree-agent-*` branches pointing at old commits.
- **Cycle count**: 2 of 3 parallel agents hit this (SignalBarGroup ARIA fix, write_real_chapters sparse-index fix); 1 succeeded cleanly (URL-encode fix, which self-recovered by fetching the target branch into a new local branch within its own worktree and pushing directly).
- **Failed approach avoided**: the `write_real_chapters` agent discovered it could bypass the git-level worktree guard with a raw Python filesystem write into the OTHER worktree's directory — it explicitly chose NOT to do this (reverted the write) because it couldn't verify/commit/attribute the change properly from its own sandboxed git context. **This restraint was correct** — CC applied the agent's fully-derived-and-verified SQL patch manually instead.
- **Breakthrough insight / prevention measure**: none implemented yet — this remains a standing risk for any future `isolation: "worktree"` dispatch. **Not fixed at the tooling level.**

### Loop 3: My own commit-staging mistake (dead test file "deleted" but not actually staged)
- **Root cause category**: `git add -A -- <explicit path list>` does not include a DIFFERENT file's deletion just because it's also in the working tree — CC deleted `web/components/__tests__/SignalBarGroup.test.tsx` via `rm`, then committed with an explicit path list that didn't include that path.
- **Cycle count**: 1 (caught by the NEXT CI run failing on the exact same import-order finding the deletion was supposed to remove — `git show HEAD:<path>` still returned the old file content despite the local working tree correctly showing it deleted).
- **Verification gap**: CC's local "clean" verification ran against the WORKING TREE (already deleted on disk), not what was actually staged/committed — a real gap in the verify-then-commit sequence.
- **Fix**: `git add -A` (no path restriction) to pick up the pending deletion, re-verified, re-pushed. **This is now itself a cautionary example worth remembering**: narrow `git add -A -- <paths>` is safer for avoiding accidental inclusion of OTHER agents' concurrent uncommitted work (see next section), but risks silently dropping your OWN deletions if you forget to list them.

## Knowledge Cycles & Productive Iterations

### Cycle: Chapters Decoupling Design (Duration: ~1 session-turn, 2026-08-06 ~00:00–00:30)
- **Trigger**: user asked directly, mid-review, "why are [chapters and the analysis stream] coupled... why don't we fetch chapters on their own... split them into a separate slot... if they fail they retry and we would already have the chapters so we don't need them again."
- **Objective**: design (not implement) a proper decoupling of chapter persistence from the chunked-analysis request lifecycle.
- **Participants**: CC (design), user (3 open-question sign-off)
- **Phases**: (1) trace actual code to prove chapters have zero real dependency on LLM/chunking (`req.metadata.description` available before any LLM call); (2) propose architecture (independent endpoint, `waitUntil` fire-and-forget, Zustand store, retry/backoff decoupled from analysis status); (3) write migration path (incremental, not a flag day — new path alongside old, remove old only after E2E proof); (4) present 3 open questions rather than guessing; (5) user answered all 3, CC updated doc.
- **Key artifacts**: `docs/specs/CHAPTERS_DECOUPLING_DESIGN_2026-08-06.md`
- **Outcome**: approved design, immediately turned into an execution prompt and a new branch/PR.
- **Lifecycle status**: design approved and PARTIALLY implemented (PR #206, in review). Old safety-net path deliberately still active.
- **Integration status**: not yet integrated with production (worker changes not deployed, migration not applied to live DB as of this handover — verify before assuming otherwise).
- **Why this matters**: this is the clearest example this session of the user redirecting an in-progress bug-fixing cycle into a proper architecture fix instead of accepting an endless patch cycle — worth recognizing this pattern (user pushes for root-cause architecture over symptom patches) as a standing preference, not a one-off.

### Cycle: Agent Dispatch Template creation (Duration: ~20 min, 2026-08-06 ~01:15–01:35)
See Chronological Timeline entry above — full detail there, not duplicated here per anti-over-summarization but this IS a genuine knowledge cycle (process/tooling design, not a bug fix) and should be treated as such by any continuing agent.

---

## Recurring Patterns / Housekeeping Reminders

### Pattern: Agent "done" reports pass unit gates but fail E2E — THE dominant recurring issue this session
- **Frequency**: at least 6 distinct confirmed instances across PR #205 alone, plus 2 more on PR #206 in the last 2 hours (see Timeline). This is not an occasional issue — it is close to the DEFAULT outcome of any single-pass agent dispatch on this feature without independent re-verification.
- **Core issue**: tsc/vitest/qa-intel all reward "does this unit compile and pass isolated tests," none of them can catch "does this actually get called from the real production code path" or "does this actually behave correctly under the real timing/concurrency conditions of the runtime it runs in" (React re-render timing, Zustand reference semantics, Postgres type-coercion edge cases, worktree/branch isolation semantics).
- **User's frustration signal**: explicit corrections ("did you start with /code-review-graph? did you do /code-reviewer /simplify?"), explicit process demands (the TEMPLATE.md creation was directly triggered by frustration with a skipped protocol step), and repeated "your X min estimate was too much/too little" recalibration requests.
- **Attempted solutions, in order of increasing rigor**: (1) prose reminders in prompts → insufficient, (2) "mandatory sections" list in CLAUDE.md → insufficient (didn't reliably reach every dispatched prompt), (3) the three-tenets framework baked into every prompt → improved but still relies on the AGENT to comply, not just the prompt to demand it, (4) CC's own independent post-hoc re-verification (live DB transactions, hand-tracing actual runtime semantics, empirical test scripts instead of trusting review-tool prose) → this is what has actually caught every real regression this session. **The mandatory template (this session's latest attempt) has not yet been tested across a full round-trip — its effectiveness is unproven as of this handover.**
- **Status**: ONGOING, not resolved. Treat every future "done" report — from OC, AGY, a remote agent, OR a code-review tool's own suggested fix — as a claim requiring independent verification, not evidence.
- **What would actually fix this**: unclear. The template addresses "did the dispatching prompt ask for the right things," not "did the executing agent actually do them." A possible next escalation: a CI gate or scripted check that specifically looks for E2E-proof artifacts (a live query result, a curl transcript) in a completion report before it's accepted — flagged as a P2 idea in Cubic's PR #206 review, not yet acted on.

---

## Current State Snapshot

### What works ✅
- PR #205 chapters feature: merged, live on `main`. Parser, DB schema, 3-state chip, chapter-priority entity-seek — all independently verified across multiple rounds.
- PR #206 decoupling: new endpoint + worker wiring + Zustand store structurally correct after 3 rounds of CC fixes (malformed-data-wipe bug, confirmed/unconfirmed race, self-cancellation race). Old safety-net path still active as a deliberate transition safety net.
- Agent-dispatch template + protocol documentation (`docs/agent-prompts/TEMPLATE.md`, `AGENTS.md` §5, `CLAUDE.md`) — written, committed, not yet stress-tested across a full agent round-trip.

### What doesn't work ❌ / unknown ❌
- **Just reported by user, NOT YET INVESTIGATED**: a live-prod history analysis (from "yesterday," image reference in the immediately-preceding user turn) shows all dimensions/metadata populated but knowledge-graph panels (Word Cloud, Mind Map, Knowledge Graph tab) empty for one persona selection ("Consultant") while switching to "Content Creator" persona made them populate. Likely a persona-scoped KG-data filtering/caching bug, NOT related to the chapters work — **status completely unknown, zero investigation done as of this handover.**
- **Also just reported, NOT YET INVESTIGATED**: entity-seek (the chapters feature's core UX payoff) described by the user as "shite" in live testing — most entities jump to "pretty much the same thing," clustering in the first minute or two of the video with only one landing in the final third. This is a live, real, user-facing quality complaint about a feature this session spent enormous effort fixing correctness bugs in — **the correctness fixes may be technically correct but the underlying LLM-extracted entity/timestamp DATA quality itself may be the actual problem** (i.e., not a code bug at all, or a different code bug than anything fixed so far — e.g., in how dimension content generates timestamp references, not in `findEntityTimestamp`'s selection logic). Zero investigation done.
- Vitest include-glob / missing jsdom gap (Troubleshooting Loop 1) — open, unfixed, will silently swallow any future `.tsx` test file added anywhere outside `lib/__tests__` with a `.test.ts` name.
- Worktree/branch-mismatch risk for `isolation: "worktree"` Agent dispatches — open, unfixed, caused 2 of 3 parallel-agent failures this session.

### In-progress
- PR #206 review cycle — Cubic flagged additional P1s not yet addressed (see Reference Index / PR #206 for full list): worker doesn't POST on empty-but-present description (can't write confirmed-empty sentinel for real empty-description videos via the NEW path specifically — note this is different from the P0 already fixed), `waitUntil` fetch doesn't check `response.ok` or have a timeout, no re-analysis cache-invalidation call site despite `reset()` existing on the store, public unauthenticated GET endpoint's privacy assumption (`videoId` alone treated as non-sensitive) not explicitly security-reviewed, 3 failing style/static-analysis checks (CodeFactor/DeepSource) still outstanding, and the PR's own description still says live deployed-worker E2E is pending (true, unresolved).
- Qodo's separate review on PR #206 (surfaced in the same user turn as this handover request, NOT yet cross-checked against Cubic's findings for overlap) — 2 bugs ("chapters retries never stop" — likely the SAME infinite-retry-loop CC just fixed independently, needs confirmation the fix covers it; "waitUntil POST ignores non-2xx" — same as Cubic's P1 above) + 2 rule violations (mixed-type import, import grouping) — **not yet independently verified against current code.**

### Blocked
- Nothing formally blocked, but the live-prod bug reports (see above) are effectively higher real-world priority than continuing PR #206's review cycle and have zero attention so far.

### Technical debt (explicitly logged, not fixed)
- `docs/TECH_DEBT_LEDGER.md`: pre-existing `transcripts` migration (sibling to the chapters one) has the same missing-REVOKE gap already fixed on the newer chapters migration — logged, not fixed (would need a new migration + live grant verification against an already-applied function).
- `docs/qa-intel/RULESET_LESSONS_LEDGER.md`: `SchemaContractRule`'s AST blind spot (can't see `.optional()` wrapping a `.refine()`'d array element) — documented, rule itself not fixed, will re-trigger on any future similarly-nested `.refine()`.

---

## Context Preservation

- **User working style**: extremely hands-on technical reviewer, reads actual code-review-tool output closely and relays it verbatim rather than summarizing, expects independent re-verification of EVERY claim (has explicitly corrected CC multiple times for not doing this thoroughly enough), values root-cause architecture fixes over patch cycles (see the decoupling design cycle), gives direct time-calibration feedback ("your 25 min est was too much... recalibrate") and expects it applied immediately, not just acknowledged.
- **Communication pattern**: pastes large raw tool outputs (Cubic/CodeRabbit/Qodo review dumps, live DB query results) and expects the receiving agent to triage/verify/act, not just summarize back. Uses terse, sometimes garbled dictated-style messages (voice-to-text artifacts visible in message history) — read for intent, not literal grammar.
- **Standing conventions** (already encoded in `CLAUDE.md`/`AGENTS.md`/memory, do not re-derive): pnpm-only tooling (never npx/npm/yarn — broken in this WSL2 environment), the three-tenets framework for every agent dispatch, `docs/agent-prompts/TEMPLATE.md` for every future dispatch, reports/investigations always written to `docs/` not just chat, `code-review-graph` MCP tools as mandatory Step 0 before Grep/Glob/Read, never perform account/credential rotation directly (give exact commands instead), semver-bump every session, negative-control verification technique explicitly praised (revert a fix, prove the symptom reproduces, reapply).
- **Automation/tooling in active use**: Supabase MCP (`execute_sql` wrapped in `BEGIN...ROLLBACK` is THE established pattern for testing unapplied migrations against the live schema without persisting anything — used successfully at least 6 times this session), `gh pr checks`/`gh pr create`/`gh pr merge` for the full PR lifecycle, the project's own `scripts/verify-quality-engine.ts --ci --compare` (note: the EXACT flags matter, the bare default run has different exit-code semantics and gives false passes).
- **Multi-agent coordination pattern established**: CC = orchestrator/verifier, never trusts a completion report at face value; OC = default execution agent for well-scoped work (runs in the SAME shared checkout as CC unless explicitly isolated — this has caused real file-mixing, watch for it); AGY = UI-specific execution, sometimes unavailable (session has had to hold AGY prompts pending availability); remote/worktree Agent-tool dispatches = for parallelizable independent work or surviving a session/laptop gap, but carry a confirmed branch-mismatch risk.

---

## Session Bridge Content (Last 3–4 Prompts) — preserved near-verbatim per the sacred-context rule

**User prompt (immediately prior to this handover request)**: pasted a screenshot of a live production history-analysis view showing all dimension/metadata content populated but Word Cloud / Knowledge Graph / Mind Map panels empty (`"No knowledge graph data"`, `"No cloud structure yet"`, `"No mind map data"`) while the "Consultant" persona chip was selected among a row of persona options (Digest/Description/Channel Meta/Comments chips above, then Content Creator/Indie Maker/Consultant/Researcher/Product Manager persona buttons below) — user reported clicking "Content Creator" persona caused all graphs to appear. Same message added a live-testing quality complaint about entity-seek: "the entity seak from any graph i tested with the vid. is shite. they all jump to pretty much the same thing more or less and only one goes in the last 3rd part of the vid. the rest are either in the first min. and one or 2 in the 3rd min." Followed immediately (same turn) by a large pasted Qodo code review (2 bugs: "Chapters retries never stop," "WaitUntil POST ignores non-2xx"; 2 rule violations: mixed-type import, ungrouped imports) and an instruction to "check the other review tools from pr yourself," followed by a very large pasted Cubic web review (multiple P0/P1/P2 findings on PR #206, detailed in Current State Snapshot above) ending with the reviewer's own bottom-line list of 7 "real merge blockers."

**CC's response to that turn**: began triaging by verifying the MOST severe claim first (Cubic's P0 self-cancellation race in `useChapters.ts`) via hand-tracing rather than trusting the review — confirmed it as real and severe, redesigned and rewrote the hook, verified via tsc/vitest/qa-intel, committed (`782d2b17`), pushed. Was mid-way through this fix when the user's handover-request message arrived (a separate, large structured prompt specifying this exact document's required format) — CC finished the in-flight fix (judged too severe/risky to leave half-done) before switching to writing this handover.

**Unresolved question hanging over this exact moment**: none from the user directly, but implicitly: does CC continue triaging the remaining Cubic P1s / Qodo findings on PR #206 next, or pivot to the two live-production bug reports (KG-panel-empty-per-persona, entity-seek clustering quality), which are arguably higher real-world impact but completely uninvestigated? **This handover does not resolve that prioritization — it is the first item in Critical Path Forward below and requires the continuing agent (or the user) to decide.**

---

## Critical Path Forward

### 1. Triage the two live-production bug reports (HIGHEST real-world impact, ZERO investigation done)
- **Dependencies**: none — can start immediately, independent of PR #206's review cycle.
- **Verification criteria**: for the KG-panel-empty-per-persona issue, find the actual code path that renders Word Cloud/Mind Map/Knowledge Graph tabs and determine whether persona selection affects which data source populates them (likely candidate: persona-scoped filtering somewhere in `DashboardContainer.tsx` or the KG synthesis nucleus — NOT verified, just a starting guess, do not treat as fact). For entity-seek quality, this is likely NOT a code-correctness bug (the timestamp-selection LOGIC was extensively fixed this session and is believed correct) but a DATA-quality issue — investigate whether the LLM-generated dimension content itself contains enough distinct, spread-out timestamp references per entity, or whether the underlying analysis prompt/pipeline is the actual root cause.
- **Edge cases**: the persona bug might be a caching issue (stale KG data cached under one persona, not invalidated on persona switch) rather than a data-fetch issue — check both.
- **Complexity**: unknown until investigated — could be small (a missing cache key) or large (a synthesis-pipeline redesign).

### 2. Finish PR #206's outstanding P1 findings (Cubic + Qodo, cross-checked)
- **Dependencies**: none technically, but doing this before #1 means the live-prod bugs stay uninvestigated longer.
- **Items** (verify each independently before fixing, per this session's standing discipline — do not batch-fix from the review text alone): worker doesn't send a POST for present-but-empty descriptions (can't write the confirmed-empty sentinel via the new path); `waitUntil` fetch doesn't check `response.ok`/timeout; no re-analysis invalidation call site for the store's existing `reset()`; public GET endpoint's `videoId`-alone-is-non-sensitive assumption needs an explicit security decision, not just an assumption; Qodo's 2 bugs need cross-checking against what CC already fixed (the "retries never stop" one is very likely already resolved by the self-cancellation fix, but CONFIRM, don't assume); 3 failing style checks (CodeFactor/DeepSource) — likely same "informational, no branch protection, not in the confidence formula" class established repeatedly this session, but verify the specific findings aren't newly-real this time.
- **Verification criteria**: same three-tenets standard as every other item this session — live E2E proof where the finding concerns runtime behavior, not just a passing unit test.
- **Complexity**: mostly small/contained fixes, similar in shape to the ones already done this session.

### 3. Deployed-worker E2E verification for the whole chapters+decoupling feature (repeatedly flagged as outstanding, never actually done)
- **Dependencies**: requires the worker to actually be deployed with PR #206's changes (or a local dev-server equivalent), and the migration applied to a real (or branch) database.
- **Verification criteria**: per Cubic's own proposed remedy — start a real analysis, observe the chapter POST fire and its HTTP status, verify the actual `transcript_chapters` row/sentinel via a live query, fetch chapters from the client BEFORE the analysis completes and confirm the store's behavior, and manually verify entity-seek behavior in a browser.
- **Edge cases**: this is exactly the step that's been deferred through the ENTIRE chapters+decoupling arc — every single round of "done" reports has skipped this specific step in favor of unit-level gates. Treat this as the single most overdue item in the whole feature.
- **Complexity**: medium — mostly about actually doing the deploy/DB-apply step, not writing new code.

---

## Reference Index

- **Design doc**: `docs/specs/CHAPTERS_DECOUPLING_DESIGN_2026-08-06.md`
- **Agent dispatch template**: `docs/agent-prompts/TEMPLATE.md`
- **Execution prompts (chronological)**: `docs/agent-prompts/2026-08-05-oc-livetest-batch.md`, `2026-08-05-oc-chapters-P0-regressions.md`, `2026-08-06-oc-chapters-decoupling.md`
- **qa-intel ledger**: `docs/qa-intel/RULESET_LESSONS_LEDGER.md` (see the 2026-08-05 `SchemaContractRule` entry)
- **Tech debt ledger**: `docs/TECH_DEBT_LEDGER.md`
- **Agent shared ledger**: `.memory/AGENT_LEDGER.md` (protocol at top of file; recent entries document the chapters-decoupling work)
- **Protocol docs**: `AGENTS.md` §5 (canonical), `CLAUDE.md` (agent roster + points to template)
- **Key source files (chapters feature)**: `worker/src/services/chapter-parser.ts`, `web/lib/utils/entity-time-seek.ts`, `web/lib/adapters/SupabaseTranscriptAdapter.ts`, `supabase/migrations/20260805*.sql` (4 migrations: table creation, RPC v13, atomic sentinel/real-chapters writes, CHECK constraint)
- **Key source files (decoupling, PR #206)**: `web/app/api/videos/[videoId]/chapters/route.ts`, `web/store/useChaptersStore.ts`, `web/hooks/useChapters.ts`, `worker/src/routes/analysis.ts` (search `Decoupled chapter persistence`), `web/lib/stream-token.ts` + `worker/src/crypto.ts` (`BoundSigPurpose`)
- **PRs**: #205 (MERGED, chapters feature), #206 (OPEN, decoupling — https://github.com/Hex-Tech-Lab/hex-yt-intel/pull/206)
- **Supabase project ref**: `adnmbikaqnxivalqoild`
- **This handover doc**: `docs/history/HANDOVER_2026-08-06_CHAPTERS_FEATURE_AND_DECOUPLING.md`

---

## Validation Checklist

- [x] Header complete (dates, agents, project, type, status)
- [x] No ambiguity in status claims — explicitly marked "not yet investigated" / "status unknown" where true, rather than implying completeness
- [x] Versions included (Node, TS, pnpm, framework versions)
- [x] Problems show resolution where resolved; explicitly marked unresolved where not
- [x] File paths are absolute-from-repo-root and were read/verified during this session, not guessed
- [x] Commands (verification gate commands) are the exact ones used this session, copy-usable
- [x] Next steps (Critical Path Forward) are concrete and actionable, not vague
- [x] Session bridge preserved near-verbatim (last user turn quoted substantially, not paraphrased away)
- [x] Iterations documented (chapters feature 5–6+ round cycle, condensed but not lost)
- [x] Troubleshooting loops documented (3 distinct loops, each with root cause + prevention status)
- [x] Knowledge cycles included (decoupling design, template creation)
- [x] Recurring patterns captured (the dominant "unit-clean but E2E-broken" pattern, with explicit "status: ONGOING, not resolved")
- [x] Key decisions tagged (🔑 markers throughout)
- [x] Verification steps included, not just claims (live DB transaction results, hand-traced React semantics, empirical Zod test scripts — cited specifically, not just "it was verified")
- [x] Multi-agent coordination logic preserved (OC/AGY/remote-agent roles, shared-checkout risk, worktree-mismatch risk)
- [x] No lost insights as far as this author can assess — confidence estimate below

**Confidence self-assessment**: ~90%. The two live-production bug reports are genuinely unexplored (correctly reflected as such throughout this doc), so their "true" complexity/scope is unknown and this document cannot close that gap — only flag it prominently, which it does. The chapters+decoupling narrative itself is captured with high confidence since it was directly observed/verified by the authoring session, not reconstructed from partial logs.
