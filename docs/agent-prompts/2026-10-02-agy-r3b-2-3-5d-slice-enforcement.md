# Agent Dispatch Prompt — R3b 2.3.5d — worker slice enforcement with K=1 fallback

> **Before filling in Target Agent/Effort below**: check CLAUDE.md's
> "Model/task-fit routing" table — UI/grunt-level work → AGY Flash, no/low
> effort; multi-hop or long-horizon work → a non-Flash tier (AGY Pro / Claude
> / OC on a stronger model); narrow well-scoped fix → OC's cheap default.
> That table decays fast (model landscape moves monthly) — if this task is
> non-trivial or expensive, skim `.memory/AGENT_LEDGER.md` for a recent real
> outcome on a similar task shape before trusting the table blindly.

**Target Agent**: AGY (gemini-3.8-flash-low)
**Effort Level**: medium

> **Before dispatching**: run the `improve-prompt` skill against the filled-in
> prompt below. It mechanizes this file's own Model-tuning rule and report
> contract as a checklist — cheaper than re-deriving them from memory each
> time, and catches drift the way this template's own history shows prose
> reminders alone don't.

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.
>
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

---

## Model-tuning rule — [ALWAYS APPLY, not a section to copy-paste]

**A "flash"/low-effort-tier model (AGY on Gemini Flash low, OC on GLM-5.3-flash (CoreWeave, reasoning low — see CLAUDE.md "OC model standard")) does not reliably execute prose *principles* — it executes
literal, numbered, sequential *steps*.** Stating "do contract-def, E2E, and
tangent-hunt" once as a paragraph is not enough at this tier; the model will
often satisfy the injection/entry-site case and stop, treating the
downstream chain and adjacent files as implicitly covered when they were
never actually checked. Confirmed twice on 2026-08-07: an OC dispatch that
explicitly demanded "E2E proof, not code-reading confidence" in prose still
shipped a fix backed only by a unit-test-expectation change, and a Cubic
re-review caught a real ordering-invariant gap the agent's own report never
surfaced.

Before writing sections 1–2 below, decide:
- **Small, single-file task?** One dispatch is fine, but still phrase the
  Three Tenets (section 5) as a literal numbered checklist scoped to the
  exact files/functions involved — not the generic prose block.
- **Touches more than ~2 files, or needs investigation + fix + PR?** Split
  into sequential, separately-dispatched prompts (investigate → fix →
  verify/PR), each narrowly scoped, rather than one prompt bundling all
  three. A dense 40-line prompt for one focused step beats a 200-line
  prompt covering three steps at once — length is not the lever,
  specificity per step is.
- **Requires `/pr-review-workflow`, a specific branch, or a specific PR
  number?** Name them explicitly and literally in section 2 ("create branch
  `fix/xyz`", "invoke the `/pr-review-workflow` skill", "target PR #NNN") —
  never phrase it as "follow the usual review process."

---

## 1. Context & Problem Statement

Worktree `/home/kellyb_dev/projects/hex-yt-intel-r3b-235d`, branch `feat/r3b-2-3-5d` (from origin/main). Home `/home/kellyb_dev` (UNDERSCORE). A parallel AGY run (2.3.5e) edits `web/hooks/useSSEStream.ts`, `web/lib/usecases/CreateAnalysisUseCase.ts`, contracts and a migration in another worktree: do NOT touch those.

Hard rules: work ONLY inside your worktree; never `cd` out of it; scratch files go in `<worktree>/.scratch/` only, NEVER /tmp; never `git checkout`/`restore`/`stash` uncommitted work (negative controls: `cp file .scratch/x.bak`, break, run, `cp` back); never delete, weaken or overwrite an existing test (only update one whose assertion encodes behaviour this task deliberately changes, and say so in the report); never run `pnpm qa-intel:baseline` or edit `.qa-intel/baseline.json`; run qa-intel AFTER `git add` (`pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare`, must print "No new issues since baseline" with N>0 files scanned; never `--mode full`); do NOT apply migrations (no Supabase CLI/MCP); commit, `git push -u origin HEAD`, NO PR (CC opens it). Worker tests run via `pnpm --filter @hex-yt-intel/web exec vitest run ../worker/src/__tests__/`. Watch exit codes: `cmd | tail` hides a failing `tsc`; run `tsc` without a pipe and check `$?`.

R3b 2.3.5 (approved 2026-10-01). A K>1 stream carries a v2 token that signs a transcript slice: request fields `tokenVersion: 2`, `chunkIndex`, `jevChunkIndex`, `jevChunkCount`, `streamCount`, `bundleList`, `sliceSha256`, `startWord`, `endWord` (verified by `verifyStreamToken`, merged #399; projective cells carry the empty slice `(0, 0, sha256(""))`). The shared module `worker/src/services/TranscriptSlice.ts` (re-exports `web/lib/jev/transcript-slice.ts`, merged #400) provides `tokenizeTranscript`, `sliceText` (throws RangeError on bad bounds), `sliceDigest`, `EMPTY_SLICE_SHA256`. Today the worker sends the WHOLE resolved transcript to the LLM for every stream. Nothing emits v2 in production yet (Jev is off).

User-approved mismatch policy: a slice that does not hash to `sliceSha256` must NEVER fail the cell or the analysis. Report to Sentry and fall back to K=1 semantics for that request (run the cell over the full transcript, exactly as today).

## 2. Contract & Implementation Directives

Contract, inside `worker/src/routes/analysis.ts` (`/analyze-llm-stream` handler), AFTER the transcript is resolved and BEFORE the grounded LLM call:
- Not v2 (`tokenVersion` absent or 1) → unchanged, byte for byte.
- v2 + projective bundle (empty slice) → unchanged (projective uses prior payload, not transcript words).
- v2 + grounded: compute `sliceDigest(resolvedTranscript, startWord, endWord)`.
  - equal to `sliceSha256` → the LLM receives `sliceText(tokenizeTranscript(resolvedTranscript), startWord, endWord)` instead of the full transcript (the existing transcriptBudgetChars truncation still applies after).
  - not equal, OR `sliceText` throws (endWord beyond the transcript) → `Sentry.captureMessage('jev slice hash mismatch; falling back to full transcript', { level: 'warning', tags: { operation: 'jev-slice-verify' }, extra: { analysisId, chunkIndex, jevChunkIndex, startWord, endWord } })`, send one SSE status frame `{ type: 'status', stage: 'jev-fallback', reason: 'slice_hash_mismatch' | 'slice_out_of_range' }` (use the existing `send` helper), and continue with the FULL transcript.

Steps:
1. Post `[IN_PROGRESS]` in your worktree's `.memory/AGENT_LEDGER.md`.
2. Find where the resolved transcript is handed to the prompt builder for the grounded call (search for `resolvedTranscript`, `transcriptBudgetChars`, `getUCISPrompt` in analysis.ts). Implement the contract as one small helper function (e.g. `resolveCellTranscript`) plus one call site. Do not restructure the handler.
3. Confirm the `status` fragment schema the browser validates (`web/lib/adapters/synthesis-stream-adapter.ts`, `validateFragment`) accepts `stage: 'jev-fallback'` and the extra `reason` key. If it does not, report it; do NOT edit web files (2.3.5e owns the browser).
4. Tests: add a route-level test file `worker/src/__tests__/jev-slice-route.test.ts`, reusing the harness pattern in `worker/src/__tests__/jev-plan-route.test.ts` (request + stubbed fetch, read the SSE body, inspect the OpenRouter request body). Cases: (a) v1 request → OpenRouter receives the full transcript; (b) v2 grounded, matching hash → OpenRouter receives exactly the slice words; (c) v2 grounded, wrong hash → full transcript + exactly one `jev-fallback` frame + Sentry called; (d) v2 grounded, endWord past the end → same as (c) with `slice_out_of_range`; (e) v2 projective → unchanged. Mint v2 tokens in tests with `signStreamTokenV2` from `../../../web/lib/stream-token` (see `stream-token-dual-verify.test.ts` ROUND TRIP for the env setup).
5. Negative controls (record failing counts): (i) always use the full transcript → (b) fails; (ii) throw instead of falling back on mismatch → (c) fails.
6. Gates: worker tsc `pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json` (check `0`), worker build `pnpm --filter youtube-intelligence-worker run build`, worker suite, qa-intel after `git add`.
7. Commit `feat(worker): R3b 2.3.5d — enforce the signed transcript slice; mismatch falls back to the full transcript`, push, ledger `[DONE]` with real test output and negative-control counts.

Out of scope: browser code, persistence of jev_chunk_index rows, the reducer, enabling Jev.

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

> **ENFORCEMENT**: Match touched files against the tree below. Execute ALL
> matching skills before CI/PR. Document findings under `### Skills Run +
> Findings`. **Every name below is a real, installed skill or a real external
> tool this repo's CI actually runs — verified against the live skill listing
> and `gh pr view --json statusCheckRollup` on 2026-09-05, after a prior
> version of this template was found to reference 14 skill names that do not
> exist anywhere in this environment (`fe-state-auditor`, `accessibility-a11y`,
> `bundle-analyzer`, `api-route-guard`, `worker-port-adapter-audit`,
> `idempotency-check`, `sentry-privacy-auditor`, `webhook-signature-verifier`,
> `secret-scanner`, `entity-canonicalizer`, `transcript-pipeline-audit`,
> `prompt-boundary-guard`, `monorepo-path-linter`, `ledger-protocol-auditor`).
> Do not add a skill name to this file without confirming it exists in the
> live `Skill` tool listing first.**
>
> **SELECT is re-evaluated continuously, not decided once at dispatch.** CORE
> is fixed by design — it never changes regardless of what the task touches.
> SELECT exists specifically because the diff's real footprint isn't always
> known upfront: a task that starts in `web/components/**` can legitimately
> land in `supabase/migrations/**` once you follow the actual fix. **Every
> time the touched-file set grows beyond what it was when you last matched
> against this tree — a tangent, a new file, scope discovered mid-task — re-run
> the IF-matching below against the new file set before continuing.** Treating
> SELECT as a one-time decision at the top of the task is the single most
> likely way a real skill goes unrun: the file that would have triggered it
> wasn't touched yet when the tree was first consulted. Log each re-match in
> the final report's `### Skills Run + Findings` section with what triggered
> the re-check ("touched `supabase/migrations/*.sql` mid-task, added
> `supabase-postgres-best-practices` + `database-sentinel`"), not silently.

- **STEP 0 — before any Grep/Glob/Read (token-savings, always first)**:
  - `build-graph` (rebuilds/updates `.code-review-graph/graph.db`), then use
    its query surface — `query_graph_tool`, `get_impact_radius_tool`,
    `get_affected_flows_tool`, `detect_changes_tool`, `get_review_context_tool`
    — to scope blast radius before reading whole files. If the graph MCP is
    not connected this session, note that explicitly and fall back to the
    project-local `explore-codebase` / `review-pr` / `review-delta` /
    `review-changes` / `debug-issue` / `refactor-safely` skills instead of
    silently skipping this step.

- **ALWAYS (all PRs)**:
  - `qa-intel` — run in **both** `--mode diff` and `--mode full` (never trust
    one mode's "clean" result alone — standing project rule; verified real
    CLI flags against `scripts/verify-quality-engine.ts`'s own `--help`
    output and `package.json`'s `qa-intel`/`qa-intel:ci`/`qa-intel:baseline`
    scripts on 2026-09-05 — the flags are `--mode <diff|full|watch|
    working-tree|HEAD>` and `--compare`, NOT bare `--diff`/`--full`).
  - `code-reviewer` — correctness/maintainability/contract-gap review.
  - `simplify` — reuse/simplification/efficiency/altitude pass, applies fixes.
  - `review-delta` — token-efficient delta review with blast-radius detection.
  - `review-duplication` — scan for reinvented utilities / duplicated logic.
  - `contract-auditor`: `pnpm exec tsx web/scripts/contract-auditor.ts` — flags raw boundary pass-throughs and unvalidated payloads (grep/AST based — its name notwithstanding, it contains no Zod `safeParse` call; see the script).

- **IF `web/components/**` | `web/hooks/**` | `web/app/**` (FE / UI)**:
  - `react-best-practices` — hook deps, stale closures, hydration, layout stability, bundle size.
  - `composition-patterns` — boolean-prop proliferation, compound-component / render-prop opportunities.
  - `web-design-guidelines` — accessibility, UX compliance, Web Interface Guidelines.
  - `react-view-transitions` — IF the diff adds page/route transitions or enter/exit/list-reorder animations.

- **IF `worker/**` | `web/app/api/**` | `*ports*` | `*adapters*` (BE / API)**:
  - `owasp-top-10` — IF the diff adds an external fetch, auth/signature path, secret/credential handling, or a new webhook/API entrypoint.
  - `race-condition-guard` — IF the diff mutates shared state under concurrency (webhooks, queues, workers, double-submit-prone endpoints) — TOCTOU/check-then-act/idempotency.
  - pr-review-toolkit plugin: `silent-failure-hunter` — IF the diff touches error handling / catch blocks (same bug class as qa-intel's ErrorTaxonomyRule, narrower focus).
  - pr-review-toolkit plugin: `type-design-analyzer` — IF the diff changes TypeScript type/interface shapes.

- **IF `*billing*` | `*Paddle*` | `middleware/**` | `auth/**` (Security / Billing)**:
  - `owasp-top-10` — parameter injection, broken access control, CORS, input sanitization.
  - `race-condition-guard` — webhook redelivery / out-of-order-event races (real finding class, see PaddleBillingAdapter TOCTOU, 2026-09-05 audit).
  - `database-sentinel` — IF the change touches credential handling, RLS, or auth bypass surfaces.

- **IF `supabase/migrations/**` | new table/index | raw SQL/query change**:
  - `supabase-postgres-best-practices` — query/index/lock patterns.
  - `supabase` — broader: RLS, Auth, Edge Functions, Realtime, Storage, pg_cron/pg_vector.
  - `database-sentinel` — RLS/rules misconfiguration, exposed credentials, auth-bypass audit.
  - `db-arch-10x` — heavier structural audit; invoke when the diff is migration-heavy, adds >1 table/relationship, or the user explicitly asks for a schema audit (not on every small migration).
  - **Mandatory sub-check whenever a migration creates or replaces a function**: verify `REVOKE EXECUTE ... FROM anon, authenticated, public` is present unless the function is genuinely meant to be client-callable, AND that any ownership/authorization check inside a `SECURITY DEFINER` function checks the actual role (`auth.jwt() ->> 'role'`) rather than inferring service-role from `auth.uid() IS NULL` (real fail-open IDOR found this way, 2026-09-05 audit, `get_temporal_subgraph`). Verify live via `select grantee, privilege_type from information_schema.routine_privileges where routine_name = '<fn>'` after applying — don't just trust the SQL text.
  - `planetscale-postgres-safety-review` is **NOT applicable to this repo** (wrong DB platform — Supabase Postgres, not PlanetScale). Do not invoke.

- **IF `scripts/**` | `.memory/**` | `*.config.*` | `.*ignore` (Monorepo / CI)**:
  - `qa-intel` — `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare` (also run in `--full` mode per the ALWAYS rule above).
  - pr-review-toolkit plugin: `comment-analyzer` + `pr-test-analyzer` — PR description/test-coverage sanity.

- **High-stakes / genuinely contested decisions ONLY (not a per-PR gate)**:
  - `llm-council` — architecture-level forks or business-tradeoff calls. Ask the user full 13-advisor vs. scaled-down 5-advisor mode before invoking.
  - `stress-test` — Verbalized Sampling to challenge a conclusion when confidence in the merge decision itself feels shaky.

- **Suspected Vercel cost/perf regression (new route, new data-fetch pattern, bundle growth)**:
  - `vercel-optimize` — metrics-first (needs Observability Plus), not code-only guessing.

- **Explicitly NOT installed / do not reference as available**: `webapp-testing`, `agent-browser` (confirmed absent, not stubs). `code-modernization` plugin exists but is scoped to legacy COBOL/.NET-Framework migrations — wrong shape for this stack, do not enable for routine review.

---

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```

## 4b. External CI / Tool Stack (runs automatically once PR is opened — verify, don't assume)

Confirmed live on this repo via `gh pr view <n> --json statusCheckRollup` (2026-09-05, PR #286):
`Cubic` (AI code reviewer — architecture/pattern), `CodeRabbit` (logic/edge-case review), `Snyk`
(dependency security), `DeepSource` (JS/Shell/Secrets static analysis), `CodeQL` (2 workflows:
"CodeQL" and "CodeQL - Code Quality" — javascript-typescript/python/actions), `OSSAR`, `Codacy
Static Code Analysis`, `Sourcery review`, `Vercel` (preview deploy), `Netlify` (deploy-preview +
header/redirect/pages checks — also live on this repo, not previously documented anywhere in
this file), `Supabase Preview` (branch preview — note: shows `SKIPPED` on PRs where branch
previews aren't provisioned; do not treat a SKIPPED Supabase Preview as a passed migration
check — it means the migration was NOT dry-run automatically, verify manually).

**Before merge, use the discovery check to confirm which of these actually ran and passed —
never assume the full stack fired just because the PR opened**:
```bash
gh pr view <n> --json statusCheckRollup | jq '.statusCheckRollup[] | .name // .context, .conclusion // .state'
gh api repos/{owner}/{repo}/code-scanning/alerts?state=open | jq 'length'
gh api repos/{owner}/{repo}/dependabot/alerts?state=open | jq 'length'
```
A missing gate (e.g. Cubic absent from the rollup entirely) is itself a finding — see PR #270
(2026-08-26), which merged without Cubic and shipped a real TOCTOU bug that gate class exists to
catch. Do not merge on a missing required gate without an explicit, logged waiver.

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
