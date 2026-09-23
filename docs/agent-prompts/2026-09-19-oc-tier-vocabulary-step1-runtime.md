# Agent Dispatch Prompt — Tier vocabulary unification — STEP 1 of 3: runtime path (UserTier type, updateUserTier, Paddle webhook price→tier)

> **Before filling in Target Agent/Effort below**: check CLAUDE.md's
> "Model/task-fit routing" table — UI/grunt-level work → AGY Flash, no/low
> effort; multi-hop or long-horizon work → a non-Flash tier (AGY Pro / Claude
> / OC on a stronger model); narrow well-scoped fix → OC's cheap default.
> That table decays fast (model landscape moves monthly) — if this task is
> non-trivial or expensive, skim `.memory/AGENT_LEDGER.md` for a recent real
> outcome on a similar task shape before trusting the table blindly.

**Target Agent**: OC (opencode, openrouter/z-ai/glm-5.3-flash, per committed .opencode/opencode.json). Verify the `> build - <model>` banner on launch.
**Effort Level**: low (pinned by config); investigation-heavy — be thorough in the report instead

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

**A "flash"/low-effort-tier model (AGY on Gemini Flash low, OC on DeepSeek
Flash low) does not reliably execute prose *principles* — it executes
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

**Raw finding (do not assume a root cause — investigate; everything below is verified fact, not diagnosis).** The user-facing tier names disagree across three places, and paying customers may not receive the tier they buy:

| Place | Values | Where |
|---|---|---|
| `UserTier` (TS type) | `free \| pro \| enterprise` | `web/lib/types/billing.ts:8` |
| `PriceTier` (pricing config) | `free \| light \| pro \| max \| founder \| founder_tier_a \| founder_tier_b` | `web/lib/config/pricing.ts:34` |
| `retention_policies.tier` (DB CHECK) | `free \| light \| casual \| core \| power \| pro \| enterprise \| admin` | `supabase/migrations/20260809122802_retention_policies.sql:11` |

**Product truth** (the private council reports are NOT available inside worktrees, so the relevant facts are inlined here): the LLM Council Wave 1 (2026-08-17) fixed the customer-facing structure as **Free / Light / Pro / Max**. On 2026-08-18 the user corrected the framing: tiers differ by **feature exposure and volume, never by which model computes them**. The founder pricing spec (2026-08-14, which predates that structure and still describes the old `free|pro|enterprise` code) says **founder pricing is a *price*, not a tier** — same `pro` feature set, discounted price. ADR 027 proposes a `pricing.tiers` Settings Registry key as the eventual single source of truth; it is **not built** (`web/lib/config/pricing-registry.ts` does not exist) and is **out of scope for this step**.

**Known pointers (start here, do not stop here):**
- `updateUserTier` is typed `tier: 'pro' | 'free'` in `web/lib/ports/BillingPersistencePort.ts:14`, `web/lib/adapters/SupabasePersistenceAdapter.ts:387`, and `web/lib/adapters/SupabaseBillingAdapter.ts:16`.
- The legacy `web/app/api/billing/webhook/route.ts` writes `'pro'` on *every* `subscription.created/updated` (line 39) and `'free'` on cancel (line 47); it is allow-listed in `web/middleware.ts:141`.
- A newer path exists from the 2026-08-26 Paddle work (commits `85eb4eea`, `2b5d497d`): `web/app/api/webhooks/paddle/route.ts`, `web/lib/usecases/ProcessPaddleWebhookUseCase.ts`, `web/lib/usecases/GetUserEntitlementsUseCase.ts`, `web/lib/adapters/PaddleBillingAdapter.ts`. No price→tier mapping was found in `ProcessPaddleWebhookUseCase.ts` by grep.
- `UserTier` is imported by 15 files: `web/app/api/usage/summary/route.ts`, `web/components/billing/checkout-button.tsx`, `web/lib/adapters/{PaddleBillingAdapter,PostgresBillingAdapter,RedisTrafficAdapter,SettingsModelAdapter}.ts`, `web/lib/billing-factory.ts`, `web/lib/ports/{AuthPort,BillingPort,BillingQuotaPort,ModelResolutionPort,TrafficGuardPort}.ts`, `web/lib/usecases/{CreateAnalysisUseCase,GetUserEntitlementsUseCase}.ts`.
- Price IDs and their provider mapping already live in `web/lib/config/pricing.ts` (`founder_tier_a`/`founder_tier_b` are sandbox placeholders).

**What is NOT yet known (you determine these and report them):** (a) which webhook route Paddle actually calls / whether the legacy one is dead code; (b) how many places branch on tier literal strings and would mishandle `light`/`max`; (c) READ-ONLY: whether the `users.tier` column has a CHECK constraint, and how the SQL quota functions (`supabase/migrations/20260521210000_hardening_wave_4_fixes.sql`, `20260607231000_c1_quota_auth_bypass.sql`, `20260612120000_atomic_compare_and_reserve.sql`) treat tier values other than `free`/`pro`. **Do not write any migration in this task.**

**Scope of this dispatch = STEP 1 of 3 only.** Step 2 (DB constraint / SQL functions) and step 3 (ADR 027 registry) are deliberately NOT part of this task; CC will ask the user before either starts.

---

## 2. Contract & Implementation Directives

**Objective**: a customer who buys Light, Pro or Max receives exactly that tier in `users.tier`, through one shared price→tier mapping, with the TypeScript types unified on the product vocabulary. **Code-only. No migrations, no Settings Registry changes, no pricing/founders page edits, no `paddle.ts` env handling changes.**

1. **Investigate first.** Before editing, write into your report (§ Report Format) a table of every site that (i) writes a tier, (ii) branches on a tier string literal (`'free'`, `'pro'`, `'enterprise'`, `=== 'pro'`, `Record<UserTier, …>`, etc.), across `web/` and `worker/`. Answer questions (a)–(c) above with file:line evidence.
2. **Canonical type.** `UserTier` becomes `'free' | 'light' | 'pro' | 'max' | 'enterprise'`. Keep `'enterprise'` (the DB CHECK allows it and code may reference it); do **not** add `admin`/`casual`/`core`/`power` (DB-only values — step 2's problem; list any code that references them). Let the compiler find every exhaustiveness break and fix each deliberately (no blanket `as UserTier` casts, no `default:` that silently treats unknown as `pro`).
3. **Widen `updateUserTier`** in the port and both adapters to `UserTier`.
4. **One price→tier mapping.** Add a single function (in or next to `web/lib/config/pricing.ts`, reusing its existing price-ID resolution and `PriceTier` keys — no second hardcoded price table) that maps a Paddle price ID to a `UserTier`. Every webhook path that sets a tier must use it.
5. **Unknown price ID must fail closed.** The old behaviour granted `pro` for anything. New behaviour: an unrecognised price ID must **not** change the user's tier; it must log an error and be captured to Sentry with the price ID (no PII). Decide and document whether the handler returns non-2xx (so Paddle retries) or 2xx; justify from Paddle's retry semantics and the existing handler contract.
6. **Founder price IDs (`founder`, `founder_tier_a`, `founder_tier_b`): do NOT invent a decision.** Preserve today's effective behaviour (`pro`, per the founder spec's "same pro feature set") and list this in your report under **NEEDS USER DECISION**, with what each option would change.
7. **Legacy webhook**: do **not** delete it. Establish from evidence (middleware, docs, tests, Paddle config references) whether it is live. If both routes are live, both use the shared mapping. Report the liveness verdict and a deletion recommendation.
8. **Tests + mandatory negative control.** Unit tests for: each of Light/Pro/Max price → correct tier; cancel → `free`; unknown price → tier unchanged + error logged; a compile-time exhaustiveness check on `UserTier`. Then **prove the tests fail against the old hardcoded behaviour** (e.g. temporarily restore `tier: 'pro'` in the mapping's place and show the Light/Max test failing), and include that output in your report. A test that cannot fail is not evidence.
9. **Do not touch** anything outside this scope. If you find adjacent problems, list them under "Adjacent findings" — do not fix them.
10. **Git**: work only in your worktree on branch `fix/tier-vocabulary-runtime-path`. Commit locally. **Do NOT push and do NOT open a PR** — CC reviews the diff first and independently re-runs the gates (OC self-reports were wrong in 3 of the last 4 dispatches; expect verification, not trust).

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
  - `contract-auditor`: `pnpm exec tsx web/scripts/contract-auditor.ts` — strict Zod `safeParse`, retain typed `.data`, flag raw pass-throughs.

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
