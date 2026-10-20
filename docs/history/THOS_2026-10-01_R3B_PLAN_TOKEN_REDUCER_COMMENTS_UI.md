# THOS — 2026-10-01 — Comments UI/CAS/history row, R3b 2.0→2.4b (zero-downtime chunk key, plan endpoint, token v2, reducer), backfill NOT run

**Handover for the next CC session. Built on `docs/agent-prompts/TEMPLATE.md` (newest template).** Read this whole file, then `.memory/AGENT_LEDGER.md` (tail ~30), then `.memory/SESSION_TODO.md`, before touching anything. Everything needed to continue without asking the user is here.

> **Before filling in Target Agent/Effort below**: check CLAUDE.md's
> "Model/task-fit routing" table — UI/grunt-level work → AGY Flash, no/low
> effort; multi-hop or long-horizon work → a non-Flash tier (AGY Pro / Claude
> / OC on a stronger model); narrow well-scoped fix → OC's cheap default.
> That table decays fast (model landscape moves monthly) — if this task is
> non-trivial or expensive, skim `.memory/AGENT_LEDGER.md` for a recent real
> outcome on a similar task shape before trusting the table blindly.

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

### 1.1 Roles and standing user rules (apply every turn)
- **CC = sink orchestrator / verifier.** User directive (2026-10-01, repeated): "use oc when you can and run in parallel for efficiency"; "you are not calling oc for any legwork!". Every implementation or fix round goes to OC through a TEMPLATE-based prompt saved under `docs/agent-prompts/`. CC verifies (re-runs tests, qa-intel AFTER `git add`, its own negative controls) and merges. CC edits directly only for a one-line fix or after the two-strike cutoff. See memory `delegate-legwork-to-agents`.
- **Thought-partner mode:** the user pastes "Master Orchestrator" directives and external PR reviews. **Push back with evidence.** Several directive claims this session were false (the backfill "executed successfully" twice, the "env trap" root cause), and some review findings were wrong (`toHaveLength` on a Set works). Verify against the production DB, logs and code before accepting any claim.
- **OC model standard and two-strike cutoff:** see CLAUDE.md "OC model standard" and memory `oc-two-strike-cutoff`. Watch every run live (log + `git status`).
- Reports as HTML (memory `reports-as-html`), pnpm only, live todo in `.memory/SESSION_TODO.md`, migration dry-runs (ADR 018), qa-intel baseline is never regenerated, only appended entry by entry for proven pre-existing findings.

### 1.2 OC failure modes seen THIS session (watch for all of them)
1. **Erased its own work** with `git checkout <file>` during a negative control (2.2). Every prompt now says: back up into `.scratch/`, never checkout/restore/stash uncommitted work.
2. **`cd` outside the worktree, or `/tmp` use.** A rejected tool call ENDS the run (2.2, 2.5). Prompts say: never cd, `.scratch/` only. Copy needed inputs (e.g. the private ADR 037 doc) into `<worktree>/.scratch/`.
3. **Searched the filesystem** (`find /`, `ls` of parent dirs) for a missing doc (2.5). Killed it.
4. **Degenerate text loop** (2.3 run 1: synonym-chaining word salad).
5. **Overwrote existing tests** with its own (2.3: 3 `findCachedAnalysis` tests replaced; CC restored them).
6. **Falsely reported "qa-intel: no new issues"**, either by running qa-intel before `git add` (it then scans 0 files) or by claiming clean with 36 findings open (2.3). ALWAYS re-run `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare` yourself on the committed diff and check "N files scanned".
7. **Ran `pnpm qa-intel:baseline`** (2.3W). This time it didn't change the file; always diff `.qa-intel/baseline.json` (`jq length` must stay 223 unless CC appended).
8. **Wrote helper-only tests** when route-level tests were required (2.3W, PR #392 gap).
9. **Network stalls:** an idle log for more than 10 minutes means kill and relaunch. That doesn't count as a strike.

Watcher loop used (background, notifies on commit/stall/loop; gate the loop check on log size > 30 KB or the echoed prompt false-triggers it): see the ledger/session for the `until ...; do sleep 20; done` pattern.

### 1.3 Process lessons (also in memory)
- **Parallel OC PRs conflict on `.memory/AGENT_LEDGER.md`** → GitHub SILENTLY skips every `pull_request` workflow (no Lint, Type Check or Unit Tests; only bots report). If core checks are missing, check `gh pr view N --json mergeable`, then rebase. Discard OC's uncommitted ledger edits before rebasing, and log the outcome in the main checkout's ledger.
- **Migrations auto-apply on merge** (CI `supabase db push` and/or the Supabase GitHub integration, which applied #384 before CI's job ran). So: additive migration PR first → code PR → destructive (DROP) PR only after the code is deployed. Do that every time.
- **Supabase Preview** fails with "storage config 404" (infra). Dry-run instead: `begin; <statements>; select <postconditions>; rollback;` through Supabase MCP `execute_sql`, then confirm production is unchanged.
- **CodeFactor "Complex Method"** and test-style findings: the user authorized `--admin` override. Lint (qa-intel), Type Check and Unit Tests must be green.
- `gh run list --branch X` hides PR runs (`exclude_pull_requests=true`). Use `gh pr checks N` or `actions/runs?head_sha=`.

### 1.4 Merged this session (2026-09-30 PM → 2026-10-01), with merge commits
| PR | What | Merge |
|---|---|---|
| #381 | #374 follow-ups: Upstash heal is compare-and-set (`EVAL`), only a positive-integer `ex` counts as an envelope, rejected EVAL is logged; `scripts/backfill-comments-cochran.ts` (count pre-flight via worker `/fetch-metadata`, `mode:'cochran'` on insert, escaped archived LIKE, strict counts, stale-pending >1h recovery, batched done-set) | b4e518df |
| #382 | History row v3 (fixed rows, dark halo, no divider/arrow, GlowBorder edge-spin while loading, platform+status+duration bottom-right) + a11y `aria-busy`/accessible name + Enter/Space test | e135d09e |
| #383 | Comments Dispatch B: `GET /api/comments/runs/[analysisId]`, `useCommentInsights` (single module-level poll loop, abortable, resets per analysis, survives failed polls, 3-min cap → 'none'), `CommentInsightsCard` ("Sampled pool: X of Y comments fetched (YouTube returns up to ~2,000) · ±Z% at N% confidence", native `<meter>`), dashboard chip "Analyzing sentiment…". Admin-merged over Codacy's same-origin-fetch warning | 7342bed7 |
| #384 | R3b 2.0 additive migration `20260930180000`: `analyses.stream_count` (default 5), `analysis_chunks.jev_chunk_index` (default 0), `unique_analysis_chunk_cell` | 18ad551e |
| #385 | R3b 2.1: chunk upserts on the 3-column key; every chunk_index-keyed read (adapter + reaper `tryChunkRecovery`) filters `jev_chunk_index = 0`; 4 pre-existing findings appended to the baseline (219→223) | f0e19806 |
| #386 | R3b 2.1b: `20260930190000` DROP of legacy `unique_analysis_chunk` (live) | bc8fadd9 |
| #387 | R3b 2.4: `web/lib/services/reduce-grounded-chunks.ts` (pure reducer, not wired yet) | 1b0d52d3 |
| #388 | R3b 2.2: `signStreamTokenV2`, `signTranscriptSlice`, worker dual verify (`tokenVersion: 2`); nothing EMITS v2 yet | 290bb2b8 |
| #389 | R3b 2.3a migrations `20261001090000` (registry `analysis.jev.maxCostUsdCentsPerVideo`, default 100¢) + `20261001100000` (`analyses.jev_plan jsonb`), both live | 3f2c910e |
| #390 | R3b 2.3: `PlanAnalysisUseCase` (pure), `POST /api/analyses/[id]/plan` (S2S HMAC purpose `'plan'`, writes only while the stored plan is null), inline planning in `CreateAnalysisUseCase` (job response carries `jevPlan`; failure non-blocking) | b4b32f39 |

Production state verified 2026-10-01: latest migration `20261001100000`; only `unique_analysis_chunk_cell` on `analysis_chunks`; Jev OFF (`analysis.jev.enabled` false/absent ⇒ K=1 everywhere).

### 1.5 OPEN — in flight at handover
- **PR #391 (R3b 2.4b reducer hardening): MERGED at handover.** CC-verified (26 tests; negative controls: duplicate-index guard → 1 fail; going back to counting only received chunks → 3 fail). CI was finishing at handover. **Merge when Lint/Type/Unit are green** (override CodeFactor only).
- **PR #392 (R3b 2.3W worker plan event) — DRAFT:** emits `event: plan` / `data:{v:1,source,K,streamCount,cells,estimateCents,truncatedFallback}`. K=1 fallback on any `/plan` failure. **Gap:** only helper tests. Dispatch OC (template) for route-level tests: plan event comes before the first grounded token; the LLM call still happens after `/plan` 500/timeout/bad JSON; projective bundles make no `/plan` call and emit no plan event. Negative controls. Then un-draft and merge.
- **2.3C (client) — OC run was still running at handover** in worktree `/home/kellyb_dev/projects/hex-yt-intel-r3b-23c`, branch `feat/r3b-2-3c-client-plan`, log `/tmp/claude-1001/-home-kellyb-dev-projects-hex-yt-intel/b6dfa071-43f2-446a-ae97-da6ffe823e4e/scratchpad/oc-r3b-23c.log` (may be gone after reboot). Prompt: `docs/agent-prompts/2026-10-01-oc-r3b-2-3c.md`. Check `git -C <wt> log origin/main..HEAD`. If it committed: verify (K=1 makes exactly the same 5 requests as before; K>1 still 5 + warn; `jevPlan` forwarded in request bodies; the Zod schema must ALLOW the extra `estimateCents` key from 2.3W). If it died: relaunch once with a correction.
- **R3b 2.5 PARKED (user decision):** WIP `0b102617` on `feat/r3b-2-5-finalize` (OC partial, 23 tests failing, no new tests, `chunksAreFullyComplete` silently changed to accept extra rows = unrequested semantic change). Unpark only after 2.3W/C are merged and stable in production. Also bring in the #387 review items that belong to 2.5 (propagate `partial`, conditional confidence).
- **Comments backfill: NOT RUN in production.** DB at handover: 1 `comment_sample_runs` row ever (CC's failed pilot 2026-09-30 10:47 UTC), 0 cochran runs, 0 `commentInsights`, 45 live rows still missing comments. Production API logs show no request from the user's claimed runs. Facts: `web/.env.local` ALREADY points to production Supabase (`adnmbikaqnxivalqoild`) and holds the production service key; only its `STREAM_HMAC_SECRET` is not production's (→ worker 401). Correct user command: `set -a; source web/.env.local; set +a; STREAM_HMAC_SECRET='<prod>' pnpm dlx tsx scripts/backfill-comments-cochran.ts --apply --only=ab5f54bd-0bbf-4848-acd7-deb6db94df70` → expect `enqueued ab5f54bd… run=<id>`, then without `--only`. Dry-run: 41 enqueueable (16 counts fetched live), 4 zero-comment skips. Verify after a run: `comment_sample_runs` mode=cochran status=completed, `comment_classifications` rows, `analysis_payload.commentInsights.marginScope='sampled_pool'`, sum of `costUsd` (~$0.011/video expected). Ask the user to PASTE the actual script output.

### 1.6 Review findings triaged, NOT yet fixed (queue)
- **#388 (before v2 is ever emitted):** `bundleList` is not covered by the v2 HMAC → sign a canonical partition digest; reject an explicitly supplied unknown `tokenVersion` (currently anything ≠ 2 falls to v1); add tests where the cell values change but still satisfy the count equation and get rejected by the HMAC.
- **#390 (before Jev is enabled):** `truncatedFallback` is only a flag; actually truncate and rebuild cells/hashes/estimate, or refuse dispatch. Document the cap as a planning estimate (not a hard spend limit).
- **Rejected review claims (don't redo):** `toHaveLength(Set)` works (Vitest/chai checks size). #389's preview/conflict-drift concern: covered by the rolled-back production dry-run plus the key being absent before the migration. A null inline `jevPlan` is handled by 2.3W's worker `/plan` fallback.
- **Step 2.3.5 (multi-chunk token signing), designed after 2.3W/C merge AND after the #388 partition-digest fix:** the server pre-signs one v2 token (+ transcript-slice signature) per K>1 cell, delivered in the job response / `/plan` response. The browser never signs. Until then 2.3C keeps K=1 dispatch.

### 1.7 Other open items (unchanged from earlier THOS)
Worktree cleanup (many merged worktrees under `/home/kellyb_dev/projects/hex-yt-intel-*`), privacy (TypeSafe on the sub-processor list), highlights reel sync, ledger follow-ups (#368 9/11 split signing, R1c quota tests). The YouTube `postMessage` origin-mismatch console warning is benign: the embed API probes before the iframe loads; our `origin` playerVar is correct. Ignore it.

### 1.8 hex-expan commit guard (studied, user hasn't decided)
`hex-expan/scripts/commit_guard.py` + `jev.py`. Deterministic layer (forbidden paths, key regexes, .env) plus a Jev layer (`~typesafe/jev-latest` via OpenRouter `/api/alpha/decisions`, BLOCK ≥ 0.8, FLAG ≥ 0.5). Gaps found: the 60-line truncation also caps the deterministic checks (a key on line 61+ of a new file passes); suspected secrets get sent to a third party; serial/uncached. Offered to the user: port to hex-yt-intel and/or fix gap 1. No answer yet.

---

## 2. Contract & Implementation Directives

1. Read this THOS, the ledger tail, `.memory/SESSION_TODO.md`. `git fetch`; `gh pr list --state open`.
2. 2.3C: check the worktree state (§1.5); verify or relaunch; open its PR.
3. #391: merged at handover (nothing to do).
4. #392: dispatch OC for the route-level tests (TEMPLATE prompt, save under docs/agent-prompts/), verify with negative controls, un-draft, merge. Confirm the `event: plan` contract matches 2.3C's Zod schema (extra `estimateCents` allowed).
5. Watch production after 2.3W/C deploy (Vercel runtime logs for `/plan` errors). With Jev off, every plan should be K=1.
6. Then queue the #388 hardening (§1.6) and #390 real truncation as OC dispatches; then draft 2.3.5; then unpark 2.5.
7. Backfill: only when the user pastes real output; verify in the DB (§1.5).
8. Keep `.memory/SESSION_TODO.md` current; report as HTML when asked for reports.

---

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
