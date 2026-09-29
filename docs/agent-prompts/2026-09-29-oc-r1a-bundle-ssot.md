# Agent Dispatch Prompt — R1a — Bundle map single source of truth (Finding 2)

**Target Agent**: OC (opencode) — model `glm-preset/@preset/glm-53-flash-on-cheap` (user server-side preset, Modal-first — CLAUDE.md "OC model standard" v4)
**Effort Level**: medium

Source: CC 96-hour audit https://claude.ai/artifact/Le3vAmQY4T5PZhWFFcpFNU. Phase R1 = four SEQUENTIAL dispatches (R1a → R1b → R1c → R1d) on ONE branch `fix/r1-contracts` in ONE worktree `../hex-yt-intel-r1`. Each dispatch commits its own work. Only R1d opens the PR. CC verifies between dispatches.

**Hard rules for every R1 dispatch**
- Work ONLY in `../hex-yt-intel-r1`. NEVER edit, stash, reset, checkout or clean the main checkout `/home/kellyb_dev/projects/hex-yt-intel` (other agents' WIP lives there). The only exception is appending to its `.memory/AGENT_LEDGER.md`.
- Do NOT apply any migration to the live database (no Supabase MCP `apply_migration`, no Management API, no `supabase db push`). Write migration FILES only. CI applies them on merge (ADR 013). Production must keep working until the PR merges.
- Migration filenames: `supabase/migrations/2026092912XXXX_<name>.sql`, strictly increasing, and not colliding with any existing timestamp (`ls supabase/migrations | tail`). Then run `pnpm exec supabase db push --dry-run` if credentials allow it, and paste the output. If they don't, say so.
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

The bundle map (which dimensions each of the 5 parallel LLM streams produces) has THREE sources today, and they disagree:
1. `web/lib/config/synthesis.ts` `STREAM_BUNDLES` (~line 22; the committed version on origin/main is `[1,10],[8],[2,4,6],[5,7],[3,9,11]`).
2. `web/lib/adapters/settings-adapter.ts` `getDefaultAdminSettings()` (~line 165) hardcodes a DIFFERENT map `[1],[8],[2,4,6],[5,7,10],[3,9,11]`.
3. The live DB row `admin_settings.id='default'.stream_bundles` = `[{"dimensions":[1]},{"dimensions":[8]},{"dimensions":[2,4,6]},{"dimensions":[5,7,10]},{"dimensions":[3,9,11]}]` (CC verified by SQL 2026-09-29).
The client dispatch `web/hooks/useSSEStream.ts` (~line 141, `const STREAM_BUNDLES = config.streamBundles`) reads `useSynthesisConfig()` (`web/lib/config/synthesis-with-settings.ts` ~line 44), where the DB row wins. So a code change to the map is silently overridden in production.

Target map (user-approved 2026-09-29, CC + Master Orchestrator), with the order FIXED:
```
[1, 10]      grounded
[2, 4, 6]    grounded
[5, 7]       grounded
[3, 8]       grounded   (dim 8 = 8.1/8.2/8.4 only; 8.3 moves to the projective bundle in R1b)
[9, 11]      PROJECTIVE (+ sub-dimension 8.3, added in R1b)
```
`TOTAL_STREAMS` stays 5 (persist chunk accounting, finalize and the reaper depend on it).

## 2. Contract & Implementation Directives

**Contract.** ONE authority: the Settings Registry key `analysis.streamBundles` (type json, value `number[][]`). The server (`CreateAnalysisUseCase`) resolves it and sends it in the job response as `streamBundles`. The client dispatch uses ONLY `job.streamBundles`. Invariant, checked on the server before use: exactly 5 bundles, every dimension 1..11 appears EXACTLY once, no 0 and no duplicates. If the invariant fails, log a Sentry error and use the code constant `STREAM_BUNDLES` (which must itself pass the invariant in a unit test).

Steps, IN ORDER:
1. Setup: `git fetch origin && git worktree add ../hex-yt-intel-r1 -b fix/r1-contracts origin/main && cd ../hex-yt-intel-r1 && pnpm install --frozen-lockfile`.
2. `web/lib/config/synthesis.ts`: set `STREAM_BUNDLES` to the target map above, with a comment per bundle. Add `export function assertBundlePartition(bundles: number[][]): void` (throws with a precise message) next to it. Do NOT port anything else from the Layer 2 WIP in this step.
3. Migration A: insert `analysis.streamBundles` into `setting_definitions` + `setting_values`, following EXACTLY the pattern of `supabase/migrations/20260927120000_transcript_budget_registry_key.sql` (tier 'system', data_type 'json', default = the target map). In the SAME migration, `update public.admin_settings set stream_bundles = '<target map as [{"dimensions":[..]},..]>'::jsonb where id = 'default';` so any remaining reader agrees. Add a SQL comment that `admin_settings.stream_bundles` is deprecated in favour of the registry key.
4. `web/lib/usecases/CreateAnalysisUseCase.ts`: resolve `analysis.streamBundles` via `SupabaseSettingsAdapter.getRegistrySettings([...], { 'analysis.streamBundles': STREAM_BUNDLES })` (copy the adjacent `analysis.promptCaching.enabled` pattern ~line 218). Run `assertBundlePartition` in a try/catch that falls back to `STREAM_BUNDLES` + `Sentry.captureException`. Add `streamBundles: number[][]` to `UseCaseSuccess` and to the job returned to the client. Update the matching type in `web/lib/types/contracts.ts` if the job type lives there.
5. `web/hooks/useSSEStream.ts`: build `dimensionsList` from `job.streamBundles` (falling back to the `STREAM_BUNDLES` import ONLY if it is absent, for stale cached jobs). Remove the `config.streamBundles` read for dispatch. Leave other `useSynthesisConfig` fields alone.
6. `web/lib/adapters/settings-adapter.ts`: `getDefaultAdminSettings().streamBundles` must be DERIVED from `STREAM_BUNDLES` (`STREAM_BUNDLES.map(d => ({ dimensions: d }))`), not a literal.
7. Grep for any other literal bundle map: `grep -rnE "\[3, ?9, ?11\]|\[5, ?7, ?10\]|dimensions: \[8\]" web worker --include=*.ts --include=*.tsx | grep -v node_modules`. Tests may keep literals only when they test the literal. Fix non-test hits the same way. List every hit in the report.
8. Tests: (a) `assertBundlePartition` accepts the target map and rejects a duplicate, a missing dim, a 6-bundle map and a dim 0; (b) CreateAnalysisUseCase returns the registry value when valid and falls back when invalid (mock the settings adapter); (c) update any existing test fixture that asserted the old map, and name each one in the report.
9. Worker fixture `worker/src/__tests__/prompt-cache-request-shape.test.ts`: update the bundle literals to the target map if it has any.
10. Commit (only the files above + the migration): `fix(contracts): R1a single bundle-map source (registry analysis.streamBundles)` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push. Do NOT open a PR. STOP and report.

## 3. Pre-PR Review Skills (match touched files; re-match if the set grows)

- STEP 0: `build-graph`, then `get_impact_radius_tool` on `STREAM_BUNDLES`, `useSynthesisConfig`, `CreateAnalysisUseCase.execute`.
- ALWAYS: `qa-intel` (`--mode diff` AND `--mode full`), `code-reviewer`, `review-delta`, `review-duplication`, contract-auditor.
- `supabase/migrations/**`: `supabase-postgres-best-practices`, `supabase`.
- `web/hooks/**`: `react-best-practices`.
- `*ports*|*adapters*`: `type-design-analyzer` (UseCaseSuccess shape change).

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
1. Contract = the invariant + the single authority above. The partition test enforces it.
2. E2E: registry row → getRegistrySettings → assert → job.streamBundles → useSSEStream dimensionsList → worker request `dimensions` per stream. Show a test or log proving a dispatch uses the registry map.
3. Tangents: anything else reading `admin_settings.stream_bundles` or `totalStreams` (the admin settings UI and `/api/admin/settings`). Report them; do NOT rewrite the admin UI.

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
