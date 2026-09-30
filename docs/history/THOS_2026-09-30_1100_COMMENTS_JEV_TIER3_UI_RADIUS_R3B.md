# THOS — 2026-09-30 11:00 UTC — Comments silent-loss → Jev classifier → Tier 3 cochran runs; highlights; UI radius; R3b step 1

**Handover for the next CC session. Built on `docs/agent-prompts/TEMPLATE.md` (the NEWEST template — never the stale `.memory/TEMPLATE.md`).** Read this whole file, then `.memory/AGENT_LEDGER.md` (tail), then `.memory/SESSION_TODO.md`, before touching anything. Everything needed to continue without asking the user is here.

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

---

## 1. Context & Problem Statement

### 1.1 Roles and standing user rules (apply every turn)
- CC = orchestrator + verifier + merge sign-off. OC = executor (`glm-preset/@preset/glm-53-flash-on-cheap`), dispatched with a TEMPLATE-built prompt saved to `docs/agent-prompts/<date>-oc-<name>.md`, launched `cd <worktree> && nohup opencode run "Execute <prompt> ..." </dev/null > <log> 2>&1 &` (launch from the directory that contains every path it will touch; a rejected tool call such as `cd ../worker` ENDS the run — tell OC "never cd, use pnpm --filter").
- **Two-strike rule**: watch OC every ~4 min (log + `git status`); on the 2nd bad run of a task, CC takes it over. **This session OC failed the same ways repeatedly — expect them**: (a) finishes with gates green but **does not commit**; (b) calls qa-intel "advisory" and leaves findings; (c) **invents API shapes** that stubbed tests can't catch (Jev `choices`/`legend` → live HTTP 400); (d) **replaced `.qa-intel/baseline.json`** (157 → 16 entries) — always diff the baseline against main; (e) writes vacuous tests (floating-point "equal" case, tautological bound check) — **always run negative controls yourself**; (f) loses context after auto-compaction and stops ("no record of prior work"); (g) names migrations with colliding versions — check `ls supabase/migrations` for the timestamp.
- **Tell the user which PR each pasted review is for, every time** (user directive). Reviews arrive as pasted tables; identify by head SHA / files.
- **Jev = TypeSafe System One decision model** (`~typesafe/jev-latest` → `typesafe/jev-1.13-20260917`, OpenRouter Decisions API `POST https://openrouter.ai/api/alpha/decisions`, body `{model, state, questions}`; question shapes VERIFIED: `choice`/`noul` take a `criteria` record, `score` takes a `criteria` array). User policy: **Jev is THE model for classification/decisions, never a chat LLM.** ADR 037 Layer 0 (the CDI boundary engine) is pure math and does NOT call Jev — keep; evaluate Jev as add-on/replacement later with real data.
- Comments are an **async enrichment layer**; the analysis never waits for them. `marginOfError` covers the **sampled pool** (≤ ~1000 relevance + ~1000 newest), NOT the whole video → UI must say "Sampled pool", never "Total comments".
- User is bootstrapping: avoid spend; pilot before running paid work.
- Stack: Next.js + Tailwind v4 + **Astryx** (NOT shadcn). pnpm only. Reports the user reads → published HTML artifacts.
- **Vercel has NO PR preview deployments** (CI "Deploy to Vercel" skips PRs; Vercel lists only production). UI PRs are reviewed on production after merge (user chose this).
- Migrations: CI (`ci-cd.yml`) runs `supabase db push` on merge to main and records the correct version. Before merge, dry-run on prod in a rolled-back transaction via Management API `POST https://api.supabase.com/v1/projects/adnmbikaqnxivalqoild/database/query` with `SUPABASE_ACCESS_TOKEN` from the ROOT `.env.local` (never print it): `begin; <sql>; select <checks>; rollback;`.
- qa-intel: run `pnpm qa-intel --ci --compare` AFTER `git add`. Fix new-code findings; baseline only pre-existing ones (confirm they exist on main / sit in unchanged lines). **Never rewrite/dedupe the baseline** — append only; on conflicts, main's file + the branch's own appended entries (rebuild the branch as one commit on main if a rebase re-conflicts every commit). A touched file resurfaces all its old findings.
- CodeFactor's report is not readable via API (JS-rendered page); user authorized admin-override merges when only CodeFactor fails. Codacy "Qwik $(...)" findings are false positives (no Qwik here).
- `web/test-results.json` is rewritten by vitest — `git restore` it before committing.

### 1.2 Merged this session (all on origin/main)
| PR | What | Merge |
|---|---|---|
| #369 | OC standard + ADR 037 row + prior THOS; OC configs union (`glm-bmt`), Morph label fixed | 50aada01 |
| #370 | R4 UI hydration / Retry Missing wired / no mid-stream partial warning (CC takeover of OC) | e10b9a4e |
| #371 | Ledger follow-ups + prompt archive | b9072b29 |
| #372 | R3b step 1: pure Jev semantic boundary engine + 14 `analysis.jev.*` keys (CC Gate 1 fixed 2 engine bugs, 3 vacuous tests, prod-failing migration) | 4065a27f |
| #373 | **Comments silent loss RCA**: `UpstashCacheAdapter.set` stored the JSON request envelope as the value; GET unwraps; degraded hit refetches; Sentry | 608002f8 |
| #374 | Legacy envelope keys healed on read (re-SET with native TTL; they had TTL -1) | 7b711143 |
| #375 | Highlights: manual jump froze (YouTube keyframe overshoot vs ±1 s settle) → forward-pass settle + timeout + stale-time-safe recovery; caption follows playback ≤ 2.5 w/s; public reel wired | df606e87 |
| #376 | Jev comment classifier adapter (`JevCommentClassifier`, strict response validation, per-call cost) | 9e10e7e3 |
| #377 | UI: Sprint-1 0px radius override replaced by 8px/6px scale; one global quiet focus (`--focus-ring`); history thumbnail mockup v2 | eccc3e61 (deployed to prod 10:18 UTC) |
| #378 | Comments Dispatch A: Tier 3 `mode:'cochran'` + Jev classification + typed `comment_classifications` + `commentInsights`; all 9 review findings fixed by CC (canonical full-body HMAC, `mode` on every callback, monotonic status, NOT NULL key + sha256 fallback, `(created_at,id)` tie-break, shared config validator, confidence from zScore, `marginScope:'sampled_pool'`, `topLevelComment.id`). CI applied migration `20260930170000`; worker deployed | 62970e8c |
| #379 | History text reserves the sharp thumbnail width (`--hx-thumb-sharp`); shadow on the whole content layer; GlowBorder inner radius follows the selected radius | 5d96872c |

Prod data repairs done: 8 `analysis_payload.channelMeta` envelope rows unwrapped (0 remaining). Settings migrations live: `20260930120000` (jev engine), `20260930150000` (highlights), `20260930160000` (comments.jev.*).

### 1.3 Open PRs — none at handover
Everything above is merged. **User-accepted limitation (log, don't fix now):** the history thumbnail's sharp width (`--hx-thumb-sharp`) assumes the 112 px min row height; a taller row (wrapped title/chips) widens the sharp image past the text reserve. Future fix: container queries or a grid layout (Remediation Ledger).

### 1.4 In flight / not started
- **Backfill (authorized, NOT started — #378 is merged, migration `20260930170000` is live, worker deployed):** enqueue cochran runs for the affected rows (36 videos with comments > 0, 25 with unknown count, 6 with zero — 45 live rows have the `comments` key absent). Trigger path: `web/lib/services/aux-remediation.ts` `enqueueSystemCommentsBackfill` (orphaned harness — NOTHING calls it; no cron). Write a one-off script that, per affected row, inserts the system run via `SupabaseAuxRemediationAdapter.insertSystemCommentSampleRun` and calls the enqueue function (needs Vercel env: `cloudflareWorkerUrl`, HMAC secret — check `.env.local`). **Pilot 1 video first**, confirm `comment_classifications` rows + `commentInsights` land and the OpenRouter cost (~$0.011/video → ~$0.40 total), then the rest.
- **Dispatch B (UI, not written):** comments section shows "Analyzing sentiment…" while the run is pending/sampling, polls, then renders `commentInsights` labelled **"Sampled pool"** with population, sample size, margin of error and confidence; low-confidence count visible.
- **#374 review follow-ups (not started):** conditional heal (compare-and-set via Upstash `/eval` Lua) so a legacy read can't clobber a newer write; accept only positive-integer `ex`.
- **R3b step 2 (prompts ready, not dispatched):** branch `feat/r3b-2-contract` (pushed) holds the `stream_count`/`jev_chunk_index` migration `20260930130000_analyses_stream_count_and_chunk_matrix.sql` (NOT applied; keeps the old unique key because 3 upserts in `SupabasePersistenceAdapter.ts` use `onConflict:'analysis_id,chunk_index'`) and prompts `docs/agent-prompts/2026-09-30-oc-r3b-2-{1..5}-*.md`. Order 2.1 → 2.5, one at a time. 2.3 = user-chosen **P1 plan endpoint** (plan inline in `POST /api/analyses` when the transcript is known, else the worker calls `/api/analyses/[id]/plan` before any grounded call). ADR 037 Addendum A (private doc `docs/private/ADR_037_…`) is the contract: `stream_count = K×G+P` (legacy 5), v2 signed stream token, 2-D matrix, deterministic reduce, per-video cost cap.
- **Known UI residuals:** Astryx field wrappers still colour `:focus-within` borders with the accent (hashed atomic classes); the thumbnail sharp width assumes the 112 px min row height.
- Ledger follow-ups still open (see ledger): #368 R2b (9/11 split signing, polling deadline), R1c quota tests, OC tooling wave, highlights `share_token` vs `shared_token` bug, R2.5 sweep, R5 chat 8.4 cut.

### 1.5 Key file map (this session)
- Cache: `worker/src/services/UpstashCacheAdapter.ts` (`parseLegacySetEnvelope`, heal on GET).
- Comments: `worker/src/queue-consumers/comments-tier3.ts`, `worker/src/services/cochran-mode-engine.ts`, `worker/src/services/JevCommentClassifier.ts`, `worker/src/ports/CommentClassificationPort.ts`, `worker/src/services/MetadataScraper.ts` (`fetchCommentsPage` `order`), `web/app/api/comments/persist-sample-run/route.ts`, `web/lib/adapters/SupabaseAuxRemediationAdapter.ts`, `web/lib/services/aux-remediation.ts`, `web/lib/services/comment-sampling.ts` (Cochran + stratification).
- Highlights: `web/lib/hooks/useSegmentPlayback.ts` (`resolveTimedOutSeek`), `web/lib/hooks/useHighlightTicker.ts`, `web/components/dashboard/HighlightsScrubber.tsx`, `web/app/share/[token]/*`.
- UI: `web/app/globals.css` (radius scale, `--focus-ring`, `.hx-thumb-*`), `web/components/templates/console/AnalysisHistory.tsx`, `web/components/templates/_shared/primitives.tsx`.
- Jev engine: `web/lib/jev/boundary-engine.ts`, `web/lib/config/jev.ts`.
- Pilot artifacts (scratch, may be gone): Jev pilot on video `39hqY3nH5ug` 111/111, $0.0000278/comment, p50 0.46 s, p95 0.78 s; hyperbole pain fixed 0.91 → 0.11.

### 1.6 The user's last messages (verbatim essentials)
- "Merge PR #377 and review on production… Patch PR #378 (HMAC payload, mode, migration tie-break, null ID hash) … Merge & Migrate once CI is green … Execute Backfill … Dispatch B … wording 'Sampled pool'."
- "last deploy was an hour ago and none of the changes reflected so far????" → answered: #377 was deploying; live 10:18 UTC.
- "Once you're done with this task create the THOS for LLM handover … use the template … make sure the next session can continue without any questions needed."

---

## 2. Contract & Implementation Directives (ordered — do exactly this)

1. Read this THOS, ledger tail, `.memory/SESSION_TODO.md`. Run `git -C /home/kellyb_dev/projects/hex-yt-intel fetch && git -C … log --oneline -3 origin/main`.
2. (#378 and #379 are merged; migration 20260930170000 is live; worker deployed — nothing to do.)
3. Tell the user to eyeball the history row + thumbnail on prod (no PR previews exist).
4. **Backfill:** write `scripts/backfill-comments-cochran.ts` (tsx, uses the adapters/enqueue function; idempotent: skip rows with an existing non-failed cochran run). Pilot ONE video with known comments; verify `comment_sample_runs.status='completed'`, `mode='cochran'`, typed `comment_classifications` rows, `analysis_payload.commentInsights` (marginScope `sampled_pool`), `comments` filled; read OpenRouter cost. Report to the user, then run the remaining rows.
5. **Dispatch B** prompt (TEMPLATE-based) → OC; watch; verify UI wording "Sampled pool".
6. **#374 follow-ups** (CAS heal + positive-integer `ex`) as a small PR.
7. **R3b step 2.1** dispatch from `feat/r3b-2-contract` prompts (after the above).
8. Clean up merged worktrees (`hex-yt-intel-{r1,r1e,r4,r3b,jev,highlights,comments,ui,ledger,docs}`) when nothing is running in them.

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
---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
