# Agent Dispatch Prompt — R1d — Zod + byte cap on prior_payload at the worker boundary, then open the R1 PR (Finding 4)

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

After R1b, the browser sends `prior_payload` (grounded dimensions) on the projective stream request. The worker (`worker/src/routes/analysis.ts`, request type ~line 159, forwarded ~line 1078) accepts `prior_payload?: Record<string, any>` with no schema, no size cap and no HMAC coverage, and `worker/src/services/PromptBuilder.ts` injects `JSON.stringify(context.prior_payload)` into a paid LLM prompt. A crafted request can inject megabytes or adversarial text. The full fix (worker loads grounded dims server-side by analysisId) is phase R2. R1d is the boundary guard.

## 2. Contract & Implementation Directives

**Contract.** Worker boundary schema (Zod, in the worker; follow any existing worker Zod usage — grep `from 'zod'` in worker/src first):
```ts
PriorPayloadSchema = z.object({
  schemaVersion: z.literal('2.0'),
  dimensions: z.array(z.object({ number: z.number().int().min(1).max(11), content: z.string() }).passthrough()).max(11),
}).strict()
```
- Byte cap: `new TextEncoder().encode(JSON.stringify(prior_payload)).length <= maxBytes`, where `maxBytes` comes from registry key `analysis.layer2.priorPayloadMaxBytes` (default 65536). CreateAnalysisUseCase resolves it and sends it in the SIGNED job fields (follow how `maxPayloadBytes` / `commentsConfig` travel to the worker ~line 140). The worker has no DB access (ADR 005).
- Additional rule: `prior_payload` is only accepted when the requested bundle `isProjectiveBundle(dims)`. On grounded bundles it is dropped with a warning log.
- On a schema or size violation: reject with HTTP 400 `{error:'invalid_prior_payload', reason}` BEFORE any LLM call. `Sentry.captureMessage` level warning. Do not silently truncate.
- Only the validated `dimensions[].number` + `content` are stringified into the prompt (drop passthrough keys at injection).

Steps, IN ORDER (in `../hex-yt-intel-r1`, on top of R1c):
1. Registry migration for `analysis.layer2.priorPayloadMaxBytes` (pattern: `20260927120000_transcript_budget_registry_key.sql`).
2. Resolve it in CreateAnalysisUseCase and carry it in the job fields to the worker.
3. Worker: schema + cap + projective-only check at the request boundary in `routes/analysis.ts`, before the cascade starts.
4. PromptBuilder: inject only the validated number + content pairs.
5. Tests. The worker workspace reportedly has no vitest harness (ledger 2026-09-28). CHECK THAT FIRST: `cat worker/package.json | grep -n test; ls worker/vitest.config.* 2>/dev/null`. If there is none, put the pure validation function in a module importable from web tests (for example, the schema in `web/lib/config/` or a shared file already imported by the worker, the same way `synthesis.ts` is shared) and test it from the web vitest suite. Cases: valid; 11+1 dims; dim 0; extra root key; over the byte cap; grounded bundle with payload → dropped.
6. Commit: `fix(worker): R1d validate + cap prior_payload at the boundary` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
7. Run ALL gates in section 4a on the whole branch (R1a..R1d together). Then run `pnpm --filter youtube-intelligence-worker run build` (or the worker's build script — check package.json) and paste the bundle size.
8. Push: `git push -u origin fix/r1-contracts`. Open the PR: `gh pr create --base main --title "fix(contracts): R1 — bundle SSOT, dim-8 epistemic split, analyses grant lockdown, prior_payload guard"`, with a body listing each sub-dispatch's RCA → contract → gates, the grants verification query from R1c, and a "Migrations in this PR" list with the note that CI applies them on merge (ADR 013). End the body with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
9. Do NOT merge. STOP after the PR is open. CC verifies (SQL inspection of grants after CI applies, type checks, vitest) and owns the merge.

## 3. Pre-PR Review Skills

- STEP 0: `build-graph`; `detect_changes_tool` over the full branch diff against origin/main.
- ALWAYS: `qa-intel` (both modes), `code-reviewer`, `review-delta`, `review-duplication`, contract-auditor.
- worker/API: `owasp-top-10` (new input-validation boundary), `security-review`, `type-design-analyzer`.
- migrations: `supabase-postgres-best-practices`.
- After the PR opens: `gh pr view <n> --json statusCheckRollup` and list which external gates ran (Cubic, CodeRabbit, Snyk, CodeQL, Vercel, Supabase Preview). A missing gate is itself a finding.

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
1. Contract = the schema + cap + projective-only rule. Enforce it with the step 5 tests.
2. E2E: registry → job (signed) → client stream request → worker boundary → accept/reject → PromptBuilder injection. Show both a reject (400 before any LLM call) and an accept path.
3. Tangents: does the HMAC token cover the fields you added to the job? If `maxBytes` is client-forgeable, say so explicitly and propose the R2 fix. Do not implement R2.

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
