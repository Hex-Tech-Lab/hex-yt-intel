# Agent Dispatch Prompt — R3b 2.3.5c — POST /api/analyses/[id]/stream-tokens (per-cell v2 minting)

> **Before filling in Target Agent/Effort below**: check CLAUDE.md's
> "Model/task-fit routing" table — UI/grunt-level work → AGY Flash, no/low
> effort; multi-hop or long-horizon work → a non-Flash tier (AGY Pro / Claude
> / OC on a stronger model); narrow well-scoped fix → OC's cheap default.
> That table decays fast (model landscape moves monthly) — if this task is
> non-trivial or expensive, skim `.memory/AGENT_LEDGER.md` for a recent real
> outcome on a similar task shape before trusting the table blindly.

**Target Agent**: OC
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

Worktree `/home/kellyb_dev/projects/hex-yt-intel-r3b-235c`, branch `feat/r3b-2-3-5c-stream-tokens` (created by CC from origin/main d029d3ea, which includes 2.3.5a). Home dir `/home/kellyb_dev` (UNDERSCORE). A parallel OC run (2.3.5b) is editing `web/lib/jev/*`, `PlanAnalysisUseCase.ts` and `worker/src/services/TranscriptSlice.ts` in another worktree: do NOT touch those files.

Hard rules: work ONLY in your worktree; never `cd` (use `pnpm --filter ...` / `git -C`); `.scratch/` inside the worktree only, NEVER /tmp (a rejected /tmp call ENDS your run); never git checkout/restore/stash uncommitted work (negative controls: `cp file .scratch/x.bak`, break, test, `cp` back); never delete, weaken or overwrite an existing test; never run `pnpm qa-intel:baseline` or edit `.qa-intel/baseline.json`; qa-intel AFTER `git add`, must print "No new issues since baseline" with N>0 files scanned; never run qa-intel `--mode full` (OOM).

Approved design (2026-10-01): the browser never holds the signing secret, and a v2 token lives 120 s. Before each dispatch wave, the browser asks the server to mint one v2 token per cell it is about to start. The server derives every signed field from the STORED plan (`analyses.jev_plan`, written by #390/#392), never from the request body except the cell identifiers.

`signStreamTokenV2` (web/lib/stream-token.ts, merged in #399) takes `{ videoId, analysisId, models, streamCount, jevChunkIndex, jevChunkCount, chunkIndex, bundleList, slice: { sha256, startWord, endWord } }` and returns `{ sig, exp }`.

Patterns to copy (read them first):
- Auth + ownership: `web/app/api/analyses/[id]/projective-context/route.ts` (SupabaseAuthAdapter session → 401; `verifyResourceOwnership` → 404 when not owner; Sentry; ERROR_CODES).
- Plan shape and storage: `web/app/api/analyses/[id]/plan/route.ts` and `web/lib/usecases/PlanAnalysisUseCase.ts` (cells: `{ jevChunkIndex, chunkIndex, startWord, endWord, sha256 }`, plus `K`, `streamCount`).
- Bundle list: `STREAM_BUNDLES` in `web/lib/config/synthesis.ts`. Models: how `CreateAnalysisUseCase` resolves `models` for the job (`resolveAnalysisCascade`); the token's `models` MUST equal what the worker receives in `req.models` for that analysis, or verification fails. Find out exactly what the browser sends as `models` today and reuse the same source; say how you confirmed it.

## 2. Contract & Implementation Directives

Route contract:
```
POST /api/analyses/{id}/stream-tokens
body:   { cells: [{ jevChunkIndex: int>=0, chunkIndex: int>=1 }] }   (1..64 cells, no duplicates)
200:    { tokens: [{ jevChunkIndex, chunkIndex, sig, exp, tokenVersion: 2,
                     streamCount, jevChunkCount, bundleList, sliceSha256, startWord, endWord }] }
401 no session · 404 not found / not owner · 409 { error: 'no_plan' } when jev_plan is null
                · 409 { error: 'plan_k1' } when plan.K === 1 (K=1 keeps v1 tokens)
400 malformed body or a cell not present in the stored plan (name the offending cell)
```
1. Ledger [IN_PROGRESS].
2. Use case (domain logic, no I/O): `web/lib/usecases/MintCellTokensUseCase.ts`: input = stored plan + requested cells + videoId/analysisId/models/bundleList + a signer function; output = token list or a typed error. Look each requested cell up in `plan.cells` by `(jevChunkIndex, chunkIndex)`; `jevChunkCount = plan.K`; `streamCount = plan.streamCount`; slice fields from the stored cell. Inject the signer so the use case is unit-testable.
3. Route: thin handler at `web/app/api/analyses/[id]/stream-tokens/route.ts`: Zod-validate the body (safeParse), auth, ownership, load `jev_plan` + `video_id` through the existing persistence adapter (add a narrow read method if none exists; follow the adapter's style), call the use case with the real `signStreamTokenV2`, map errors to the status codes above. Session-gated, so do NOT add it to the middleware allowlist.
4. Tests:
   - use case: happy path for K=3 (grounded + projective cells; projective has the empty slice); unknown cell → error naming it; duplicates rejected; K=1 → plan_k1; every returned token VERIFIES through the worker's `verifyStreamToken` (import it like `worker/src/__tests__/stream-token-dual-verify.test.ts` does) with the same secret, models and bundleList; a token minted for cell A fails verification when presented with cell B's fields.
   - route (mock auth/adapters the way existing `web/app/api/analyses/[id]/*/__tests__/route.test.ts` do): 401, 404 non-owner, 409 no_plan, 409 plan_k1, 400 bad body, 200 shape.
5. Negative controls (back up, break, run, restore, rerun green), record counts: (a) take the slice fields from the request instead of the stored plan → the forged-slice test fails (add that test: a request body carrying extra `startWord`/`sliceSha256` fields must be ignored or rejected); (b) remove the ownership check → 404 test fails.
6. Gates: web tsc; worker tsc (`-p tsconfig.typecheck.json`); the new tests; full web suite; worker suite via `pnpm --filter @hex-yt-intel/web exec vitest run ../worker/src/__tests__/`; qa-intel after `git add`.
7. Commit `feat(api): R3b 2.3.5c — POST /api/analyses/[id]/stream-tokens mints per-cell v2 tokens from the stored plan`, `git push -u origin HEAD`, ledger [DONE] with real output, negative-control counts and how you confirmed the `models` source. NO PR.

Out of scope: client dispatch, worker slice enforcement, the transcript-slice module, migrations, enabling Jev.

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
