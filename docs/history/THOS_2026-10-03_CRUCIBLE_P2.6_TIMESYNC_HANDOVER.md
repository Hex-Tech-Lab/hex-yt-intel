# THOS — 2026-10-03 — Carmack K>1 crucible, audit + cleanup merged (#410–#416), TranscriptAPI fixed, Phase 2.6 time-sync #417 ready

> **Before filling in Target Agent/Effort below**: check CLAUDE.md's
> "Model/task-fit routing" table — UI/grunt-level work → AGY Flash, no/low
> effort; multi-hop or long-horizon work → a non-Flash tier (AGY Pro / Claude
> / OC on a stronger model); narrow well-scoped fix → OC's cheap default.
> That table decays fast (model landscape moves monthly) — if this task is
> non-trivial or expensive, skim `.memory/AGENT_LEDGER.md` for a recent real
> outcome on a similar task shape before trusting the table blindly.

**Target Agent**: <AGY-1 (Flash) (OpenCode) (Pro) AGY-2 OC |>
**Effort Level**: <high | medium | low>

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

**Handover for the next CC session.** Read this whole file, then `.memory/AGENT_LEDGER.md` (tail), then `.memory/SESSION_TODO.md`, before touching anything. The previous THOS (`docs/history/THOS_2026-10-02_R3B_2.3.5_2.5_MAPREDUCE.md`) §1.1–§1.2 rules still apply.

### 1.1 Roles and standing user rules
- **DELEGATE THE LEGWORK (user, 2026-10-03, repeated):** CC wrote #410–#417 itself and the user called it out. From now on: CC designs, writes TEMPLATE prompts, watches live, verifies with negative controls, triages `/code-review`, merges. Implementation and review-fix rounds go to **AGY** (OC's key is at its monthly limit): Flash low for narrow/UI tasks, Gemini Pro for multi-step tasks (Phase 2.6 step 3). Memory `delegate-legwork-to-agents`.
- **CC = orchestrator/verifier.** The user pastes "CCT / Master Orchestrator" directives; verify every claim against code/DB/logs before acting. Phase 2.6 is CC-written (multi-hop); do not hand it to Flash agents.
- **NEW standing rule (memory `skill-gates-every-pr`, 2026-10-03): run the FULL skill stack on every PR, every turn, and report each.** qa-intel CI compare before every commit (0 new); `/code-review` (Skill `code-review`) high first, then medium after every fix commit until a pass comes back clean; lint + tsc + full vitest + worker typecheck; Supabase `get_advisors` + live before/after checks for migrations/data writes; Sentry + a live production probe after every deploy; a live simulation when possible; update memory. Lesson from hex-expan: each skill found real issues every time. This session `/code-review` found 12 real issues on #417 across 4 passes that every local gate had passed.
- **PR naming:** never call a PR "PR 1/2/3" — use the GitHub number (#417, #418, …). The user asked for this explicitly.
- **OC** OpenRouter key is at its monthly limit — do not dispatch OC until the user raises it. **AGY** Flash: narrow tasks only.
- Reports as HTML artifacts; live todo `.memory/SESSION_TODO.md`; pnpm only; ADR 018 migration discipline; qa-intel baseline only text-appended for findings proven pre-existing on origin/main.
- **Merge policy:** merge on green Lint + Type Check + Unit Tests + Worker TypeCheck; `--admin` for CodeFactor / DeepSource / Codacy only after reading the findings and fixing every **major** one in new code. Read cubic's comments too (it found two real P2s on #416). The Database Migration job only runs on `main` after merge — confirm it there.
- **Never pipe a secret from `vercel env pull`**: Vercel "sensitive" vars come back EMPTY (root cause of the TranscriptAPI outage below). Read secrets from `web/.env.local` and never print them.

### 1.2 Merged this session (2026-10-02 → 2026-10-03)
| PR | What | Merge |
|---|---|---|
| #410 | 2.5e: K>1 browser cell dispatch (waves, cap, re-mint near-expiry tokens), progress-only chunks ≥1, locked drawer + live ETA, final swap, partial badge on restore | dd2588e1 |
| #412 | worker: v2 request `dimensions` must equal the signed `bundleList[chunkIndex-1]` (slice-bypass fix) | 4a300f9a |
| #413 | `/stream-tokens` only while the analysis is processing (unbilled re-run fix) | 20766186 |
| #414 | 2.5 audit P2s: degraded-plan hatch (v1 persist on a K>1 plan marks it `degraded` → read as K=1), `maxChunks` max 16, reducer `wordCount` bounds | 91c972f0 |
| #415 | admin gate: K>1 planning only when `analysis.jev.enabled` AND `users.role = 'admin'` (inline + `/plan`) | d9959423 |
| #416 | post-crucible cleanup: validation webhook MERGES (RPC `merge_analysis_validation_report`, migration 20261003010000), comment-run trigger at finalize, Word Cloud always present, 16 px spacing, worker `APP_URL` → www.getvintel.com, `GET /health/providers` + deploy gate | ea1d89ab |

**Open:** #417 Phase 2.6 time-sync (status in §1.6).

### 1.3 Production state
- **Jev is ON for the admin only**: `analysis.jev.enabled = true`, `maxChunks = 16`, `maxCostUsdCentsPerVideo = 5000` (set 2026-10-02 21:15 UTC). Standard users stay K=1 (#415). Rollback: set `analysis.jev.enabled` back to false.
- **TranscriptAPI fixed**: the CF secret had been bound with an EMPTY value since 2026-09-26 (piped from `vercel env pull`). Re-uploaded from `web/.env.local` with `wrangler secret put … --env production`; fetches now 0.31–0.68 s. `/health/providers` shows every key true; the deploy fails if TranscriptAPI's key is empty.
- Latest migrations: `20261003010000` (merge RPC, live). `20261003120000` (time-marker interval key) is in #417, not yet applied.

### 1.4 Carmack crucible (analysis `3daf3be2-5382-4754-b3f7-95199cf2d877`, Lex #309, 5:14:51)
K=11, 45 cells, 5 min 57 s, $1.128 cell spend (516k of 951k tokens cached), 11/11 dimensions, billed completed. Zero `jev-slice-verify` mismatches. One cell (2:4) returned unparseable output (failed, not retried; bundle 4 reduced from 10 chunks). Worker CF logs: 44 invocations, server-side peak overlap 7 (cap 6 + persist tail), CPU p50 213 ms / max 400 ms. The CF log export is in `docs/for_sharing/logs-2026-10-02T22_13_*`.

**Defects it exposed:**
1. Timestamps guessed (no markers in the prompt) → **#417**.
2. Reduced dimensions are concatenations (repeated "8.1/8.2" headers, placeholders, dimension 5 at 55k chars) → Phase 2.6 step 3.
3. Knowledge graph / persona / classification come from chunk 0 only (KG = 15 nodes from the first 30 min; same for the word cloud) → Phase 2.6 step 2.
4. Validation webhook wiped `validation_report` (fixed #416; rows overwritten before #416 are NOT repaired).
5. Dimension "edge spin" was added to `StreamingGrid`, but the console renders `DimensionAccordion` → not visible. Fix in the UX PR.
6. Browser rejects `kg` and `classification` SSE fragments ("Fragment validation failed") → live KG doesn't update. Untraced; may predate Jev.

### 1.5 Phase 2.6 design (approved by the user)
- **Step 1 — time-sync (#417):** real `[HH:MM:SS]` markers from the timed segments, inserted after the slice hash check, plus a `[TIMELINE]` header; budget spent on plain words; truncation warning per cell; registry `analysis.jev.timeMarkerIntervalSeconds`. This also fixes K=1 timestamps.
- **Step 2 — deterministic merge (next PR):** knowledge graph merged across chunks (dedupe by normalized label, keep the highest weight, cap the count). Persona and classification come from the projective cell, which reads the whole analysis. Files: `web/lib/jev/reduce-cells.ts` (today `{ ...firstUsable.row.payload, dimensions }`), the persist finalize, and the reaper salvage.
- **Step 3 — LLM merge job:** a new QStash webhook (`maxDuration` 300; persist's 30 s is too short). Finalize writes today's concatenation as the fallback, then publishes the job. The job runs 11 parallel per-dimension calls on the cheap `gpt-oss` tier (registry-configurable). Instructions: one section in the standard format, keep every timestamped claim, entity and number, add no facts, drop placeholders. It overwrites the dimensions, keeping the concatenation for any dimension whose merge fails. The browser's final-swap poll extends from 60 s to about 3 min. Also add to the cell prompt: "part k of K covering hh:mm–hh:mm; write each section once". Estimated cost about $0.03 per analysis (Haiku about $0.45).
- **Then the UX PR (`2.6-ux-polish`):**
  - **ETA:** it drifts by a small percentage. Use an EWMA, or base it on token velocity, instead of the elapsed / settled-cells mean (`web/lib/jev/eta.ts`).
  - **Highlights ticker:** reveal lags the speech slightly and is choppy. Framer Motion is authorized; it already speeds up and slows down with playback rate, which the user likes (keep that).
  - **"Swoosh":** confirm the asset is a real soft swoosh (the old one was a "blast"), and tie its volume to the player's volume so it scales with it and never overpowers narration.
  - **Edge spin:** on `DimensionAccordion` (§1.4 item 5).
  - **INP:** 240 ms on clicking Analyze (reported weeks ago). Profile `startAnalysis`'s synchronous store resets.

### 1.6 IN FLIGHT: #417 (Phase 2.6 time-sync), ready for review, NOT merged
- **Branch:** `feat/p2-6-time-sync`, worktree `/home/kellyb_dev/projects/hex-yt-intel-p26-time`, head `e23cb4f7`.
- **`/code-review`, 6 passes:** high → 10 findings, then medium → 1, 1, 1, 1 and 2. All were fixed with tests and negative controls except the CPU note (one extra tokenization per stream, accepted: about 213 ms of worker CPU per stream on the paid plan).
- **What the later passes found:**
  - the client-sent interval was unclamped;
  - `null`/`''`/booleans coerced to 0/1 in the registry resolvers;
  - the whitespace-vs-cut mismatch in the truncation warning;
  - provider-invented caption times (Decodo / native fall back to 3 s per caption) presented as real: now flagged `estimated` and skipped;
  - a misleading Sentry warning for estimated timing;
  - the persist schema dropped `estimated`.
- **Accepted:** transcripts already in the 72-hour Redis cache predate the `estimated` flag (only matters for caption tracks with no timing; they expire within 3 days).
- **Gates:** vitest 266 files / 2687 pass, tsc / worker typecheck / eslint 0, qa-intel clean, core CI green (§2 step 1).

### 1.7 Worktree cleanup (done 2026-10-03)
120 registered worktrees → 14. Removed 79 clean (merged or pushed) plus 6 that held only OC `.pid` files, then pruned 21 stale entries; 6 more removed after saving their `.memory/AGENT_LEDGER.md` diffs to `.memory/wip/worktree-ledger-diffs-2026-10-03/`.

**Kept, for the user to decide:**
- **Real local edits:** `hex-yt-intel-docs`, `.claude/worktrees/thos0925`, `/tmp/opencode/wt-l2`, `agy-business-case`, `pgvector-drop`, `web-agy1-worktree`, `live-status`.
- **Commits that exist only locally:** `spike2a`, `pr324`, `.kilo/worktrees/auditor`, two AGY subagent worktrees.
- **Other:** `oc-d-vector-coverage` (only an OC `RESUME.md`), and `hex-yt-intel-hotfix` (not a git checkout; a stray 320 K `web/` folder).

The main checkout at `/home/kellyb_dev/projects/hex-yt-intel` is detached at an old commit, carrying ledger and todo edits. Run `git fetch`, and do work in fresh worktrees off `origin/main`.

## 2. Contract & Implementation Directives

1. **#417:** run one more medium `/code-review` on the latest head. If it's clean and core CI is green, merge. Then confirm on `main`:
   - the Database Migration job (applies `20261003120000`);
   - the worker deploy;
   - `/health/providers`;
   - Sentry (`time-markers` warnings).

   Then run one admin analysis and check that the timestamps in the persisted dimensions are real (they should match `[TIMELINE]` ranges).
2. **Phase 2.6 step 2** (§1.5): the deterministic KG merge, plus persona and classification from the projective cell.
3. **Phase 2.6 step 3** (§1.5): the QStash LLM merge job and the browser's 3-minute wait.
4. **Re-run Carmack** (admin) and compare against §1.4: timestamps, prose, KG coverage, cost.
5. **`2.6-ux-polish`** (§1.5).
6. Run the §1.1 skill stack on every one of these, and report each skill's findings.
7. **Dispatch, don't hand-write:**
   - Steps 2, 3 and 5 go to AGY through TEMPLATE prompts saved under `docs/agent-prompts/`, in isolated worktrees: step 2 to Flash, step 3 to Gemini Pro (multi-hop), the UX polish to Flash.
   - Watch each run live with the two-strike cutoff.
   - CC verifies with negative controls and merges.

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
