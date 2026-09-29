# Agent Dispatch Prompt — R1c — Lock billing/validation columns on analyses (Finding 5)

**Target Agent**: OC (opencode) — model `glm-preset/@preset/glm-53-flash-on-cheap` (user server-side preset, Modal-first — CLAUDE.md "OC model standard" v4)
**Effort Level**: medium

Source: CC 96-hour audit https://claude.ai/artifact/Le3vAmQY4T5PZhWFFcpFNU. Phase R1 = four SEQUENTIAL dispatches (R1a → R1b → R1c → R1d) on ONE branch `fix/r1-contracts` in ONE worktree `../hex-yt-intel-r1`. Each dispatch commits its own work. Only R1d opens the PR. CC verifies between dispatches.

**Hard rules for every R1 dispatch**
- Work ONLY in `../hex-yt-intel-r1`. NEVER edit, stash, reset, checkout or clean the main checkout `/home/kellyb_dev/projects/hex-yt-intel` (other agents' WIP lives there). The only exception is appending to its `.memory/AGENT_LEDGER.md`.
- Do NOT apply any migration to the live database (no Supabase MCP `apply_migration`, no Management API, no `supabase db push`). Write migration FILES only. CI applies them on merge (ADR 013). Production must keep working until the PR merges.
- Migration filenames: `supabase/migrations/2026092912XXXX_<name>.sql`, strictly increasing, and not colliding with any existing timestamp (`ls supabase/migrations | tail`). Then run `pnpm exec supabase db push --dry-run` if credentials allow it, and paste the output. If they don't, say so.
- **Lessons (2026-09-29), MANDATORY:** the ONLY valid home path is `/home/kellyb_dev` (UNDERSCORE); any other path is rejected and kills the run. NEVER run `git stash`, `git reset`, `git checkout -- <file>` or `git clean` (the stash is shared across every worktree). To compare against the base, use `git diff`/`git show HEAD:<file>`. NEVER delete or weaken an existing test. NO gate-gaming: no empty `finally` blocks, no rewrites just to dodge a rule, no drive-by edits, and NEVER edit `scripts/quality-engine/**` or `.qa-intel/baseline.json`. A pre-existing qa-intel finding in a touched file: report it and STOP. Before committing, paste `git status --short` and `git diff --stat`.
- No hardcoded tunables (standing directive): every new number or list goes in `setting_definitions` with the code constant as the ONLY fallback.

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

## 1. Context & Problem Statement

Live DB (CC verified 2026-09-29): table `public.analyses` has RLS policies `analyses_insert_own` / `analyses_update_own` (own rows), and column grants give BOTH `anon` and `authenticated` INSERT + UPDATE on ALL 25 columns, including `billing_status` and `validation_report`. With the public anon key and their own session, a user can set `billing_status='partial'` on their own rows. The remediation sweep (ADR 019) then spends the shared OpenRouter budget on them. They can also forge `validation_report`, or insert rows without going through quota.

No browser code writes `from('analyses')` (CC grep). But SERVER routes that use the user-session Supabase client (ADR 004 request-scoped client, role = authenticated) DO write this table. Candidates from CC's grep — you must check each one for whether it uses the service client or the user client, and which columns it writes:
`web/app/api/analyses/[id]/share/route.ts` (lines ~24, ~42), `web/app/api/analyses/[id]/fail/route.ts` (~69), `web/app/api/analyses/[id]/relations/route.ts` (~85, ~121), `web/app/api/comments/persist-sample-run/route.ts` (~69, ~88), `web/app/api/chat/capture-question/route.ts` (~202), `web/app/api/webhooks/embed/route.ts` (~186), `web/lib/services/analysis-requeue.ts` (~280), `web/lib/skills/wiki-builder/wiki-builder.ts` (~195, ~224).

## 2. Contract & Implementation Directives

**Contract.** After the migration: `anon` has NO insert/update/delete on `analyses`. `authenticated` has NO insert, and UPDATE only on the exact column list that user-client server routes really write (found in step 2). NEVER on `billing_status`, `validation_report`, `validation_passed`, `analysis_payload`, `analysis_markdown`, `user_id`, `video_id`, or any token/cost column. `service_role` is unchanged. SELECT is unchanged.

Steps, IN ORDER (in `/home/kellyb_dev/projects/hex-yt-intel-r1`, on top of R1b commit 8b8d560b):
1. Live grants: ALREADY QUERIED by CC (2026-09-29, do NOT query the DB yourself). `anon` and `authenticated` each hold INSERT, UPDATE, SELECT and REFERENCES on ALL 25 columns of `public.analyses`, including `billing_status` and `validation_report`. RLS policies: `analyses_select_own`, `analyses_insert_own`, `analyses_update_own`, `analyses_delete_own` (own rows only). Get the exact 25 column names from the migrations: `grep -rn "alter table.*analyses\|create table.*analyses" supabase/migrations | head`, or from `web/lib/types/database.types.ts` if it exists.
2. For EACH candidate route above: open it, determine the client (service vs user session) and the columns written by `.update`/`.insert`/`.upsert`. Produce a table: route | client | op | columns. Also grep for any other user-client write: `grep -rn "from('analyses')" web --include=*.ts --include=*.tsx | grep -v __tests__`. Put rows NOT in the candidate list in the table too.
3. Migration `..._analyses_column_grants_lockdown.sql`:
   ```sql
   revoke insert, update, delete on public.analyses from anon;
   revoke insert, update on public.analyses from authenticated;
   grant update (<exact columns from step 2 user-client rows>) on public.analyses to authenticated;
   ```
   If step 2 finds a user-client INSERT or DELETE, STOP and report [BLOCKED] with the evidence. Do not guess. Include a header comment with the table from step 2.
4. Do NOT touch the RLS policies themselves (row ownership stays as-is). This is a grant change only.
5. Test: a SQL assertion file `supabase/tests/analyses_grants.sql` (create the directory if missing), or an equivalent documented query, that fails if `authenticated` has UPDATE on `billing_status`. Also add the verification query to the PR body later (R1d).
6. Commit: `fix(security): R1c lock analyses billing/validation columns from client roles` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push. STOP and report.

## 3. Pre-PR Review Skills

- STEP 0: `build-graph`; `query_graph_tool` callers of every route in the candidate list.
- ALWAYS: `qa-intel` (both modes), `code-reviewer`, `review-delta`.
- migrations + RLS/grants: `supabase-postgres-best-practices`, `supabase`, `database-sentinel`, `security-review`.

---

## 4a. Verification & Quality Gates (local) — paste REAL output for every line, all must exit 0

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

Scoped checklist for THIS dispatch:
1. Contract = the grant matrix above. Enforce it with the step 5 assertion.
2. E2E: for each user-client write route from step 2, show that its columns are inside the grant-back list, so the route keeps working. A route writing a revoked column = [BLOCKED].
3. Tangents: `setting_values` has user-scoped INSERT/UPDATE policies (users write their own scope). Check whether any registry key read by the analysis pipeline can be overridden at user scope (for example `remediation.*`, `analysis.*`). Report; do not fix.

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
