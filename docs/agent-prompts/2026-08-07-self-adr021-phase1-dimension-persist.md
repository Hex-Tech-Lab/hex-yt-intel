# Agent Dispatch — ADR 021 Phase 1: Dimension-Level Persistence

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `CLAUDE.md` §2 "SHARED COMMUNICATION PROTOCOL" in full. Read
`.memory/AGENT_LEDGER.md` before touching any file. Post `[IN_PROGRESS]` with
intent + target files as your first action. Post `[DONE]`/`[PARTIAL]`/`[BLOCKED]`
with a real summary as your last action.

## 1. Context

hex-yt-intel: Next.js/Cloudflare Worker/Supabase YouTube analysis platform.
ADR 021 (`docs/specs/ADR_021_GRANULAR_PARTIAL_RESUME_AND_REAPER_2026-08-02.md`)
scopes a fix for the existing bundle-level-only persistence gap: if a long
analysis is interrupted mid-stream, whatever dimensions were already
generated in the current bundle are lost, because writes only happen at
bundle boundaries. This was highlighted by the 2026-08-07 critical incident
(THOS doc `docs/history/THOS_2026-08-07_1600_TIMEOUT_RCA_AND_MULTI_PR_STABILIZATION.md`)
where a 64-min video's generation was force-aborted (root cause separately
fixed: a hardcoded LLM timeout, see commit `6c6236dd`) and NOTHING was
persisted despite multiple dimensions having already completed.

Product owner has already resolved the open ADR questions this session
(not yet written back into the ADR doc — do that as part of this task):
- **Q1 (granularity)**: dimension-level, not bundle-level, for v1.
- **Q2 (who owns "what's missing" query)**: reuse the existing
  `remediation_retry_count` field already stored in `validation_report`
  (see `web/lib/services/dimension-remediation.ts`) — no new tracking
  mechanism needed, the remediation/reaper path already has what it needs
  once per-dimension rows exist to query.
- **Q4 (retry ceiling)**: already enforced via Settings Registry key
  `remediation.maxRetries` (default 3) — do not invent a new ceiling.
- **All new tunables**: MUST go into the Settings Registry
  (`setting_definitions`/`setting_values` tables, resolved via
  `SupabaseSettingsAdapter.getRegistrySettings`), classified under the
  `analysis.*` or `remediation.*` prefix matching existing keys, not
  hardcoded. This is a hard, repeated, explicit user directive this session
  ("everyhting has to be settings registry based" — said twice).

## 2. Task

**Step 1 (investigation, do this FIRST, do not skip to implementation):**
Determine the ACTUAL current persistence granularity by reading the real
write path — `worker/src/routes/analysis.ts`'s stream handler,
`worker/src/services/PersistService.ts`, `worker/src/services/atomic-persist.ts`,
and the `web/app/api/analyses/persist/route.ts` route it calls into. Confirm
via live Supabase query (Supabase MCP `execute_sql`) whether the `analyses`
table's `analysis_payload` JSONB column, when a chunk write happens, already
contains ALL dimensions generated in that chunk so far (i.e. is the gap
narrower than the ADR document assumes — chunk-level already exists, only
true per-dimension-within-a-chunk is missing?) or whether writes are still
strictly all-or-nothing per full analysis. Do not assume — read the code and
query real rows. Report this finding explicitly before writing any code.

**Step 2 (implementation, only after Step 1 confirms the actual gap):**
Extend the write path so each dimension result, as soon as the LLM cascade
returns it, is written to Supabase immediately (upsert into the
`analyses.analysis_payload` dimensions object, merging not overwriting),
rather than waiting for the full chunk/bundle to complete. Follow the
existing atomic upsert pattern already used elsewhere in this file (do not
invent a new one) — check `worker/src/services/atomic-persist.ts` for the
established merge-via-`||` JSONB pattern from ADR-linked migrations
(`20260802124311_merge_analysis_validation_report_atomic.sql`,
`20260802124438_update_analysis_result_atomic_full.sql`) and reuse it or
extend it, not duplicate it.

**Step 3:** Update `docs/specs/ADR_021_GRANULAR_PARTIAL_RESUME_AND_REAPER_2026-08-02.md`
with the answers to Q1/Q2/Q4 above (mark them resolved, cite this session's
date), and record Step 1's actual-gap finding under a new "Implementation
Note" subsection.

**Step 4:** Any new Settings Registry key this step needs (e.g. a batch-write
debounce interval if per-dimension writes need one to avoid write
amplification) must be added via Supabase MCP `apply_migration`, then
IMMEDIATELY followed by `list_migrations` to get the server-recorded
timestamp and rename the local migration file to match exactly (ADR 018 —
do not invent your own timestamp, a mismatch silently breaks CI's
`supabase db push` for days undetected).

Phases 2-4 of ADR 021 (presence-check-on-resume, Reaper extension, selective
client dispatch) are explicitly OUT OF SCOPE for this task — Phase 1 only.

## 3. Goal / definition of done

A chunked analysis interrupted mid-bundle (e.g. abort after dimension 4 of 7
in the current chunk) has those 4 dimensions present as real rows/JSONB keys
in the live `analyses` table for that video — verified via an actual
Supabase `execute_sql` query showing the partial data, not a unit test
asserting a function was called. All new tunables resolve from the Settings
Registry with the same `getRegistrySettings(keys[], fallback)` pattern used
in `CreateAnalysisUseCase.ts`/`dimension-remediation.ts` — not hardcoded.
ADR 021 doc updated with resolved Q1/Q2/Q4 and the Step 1 finding.

## 4. Expected results

- Modified: `worker/src/services/PersistService.ts` and/or
  `worker/src/services/atomic-persist.ts` (whichever the Step 1
  investigation shows is the right layer), `worker/src/routes/analysis.ts`
  call site if the trigger point moves.
- New or modified Supabase migration if a new setting/column is needed,
  correctly renamed per ADR 018.
- Updated `docs/specs/ADR_021_GRANULAR_PARTIAL_RESUME_AND_REAPER_2026-08-02.md`.
- A PR opened via `/pr-review-workflow` skill (invoke it explicitly, follow
  its phases) targeting `main`, branch named `feat/adr021-phase1-dimension-persist`.

## 5. Task-specific skills/tools/MCPs

Beyond CORE (qa-intel, contract-auditor, `/simplify`): `supabase` skill and
`supabase-postgres-best-practices` skill (this touches migrations and a
SECURITY-relevant atomic upsert path — verify the REVOKE EXECUTE sub-check
if any new/replaced function is added). Supabase MCP tools:
`execute_sql` (live verification), `apply_migration` + `list_migrations`
(ADR 018 process), `get_advisors` after any schema change.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Run `code-review-graph` MCP's `build_or_update_graph_tool`
then `get_review_context_tool`/`get_impact_radius_tool` scoped to
`worker/src/services/PersistService.ts`, `worker/src/services/atomic-persist.ts`,
`worker/src/routes/analysis.ts` before reading full files.

**[FILL IN]**: Start from `main` (clean, tip `9604b3bd` as of dispatch).
Read `docs/specs/ADR_021_GRANULAR_PARTIAL_RESUME_AND_REAPER_2026-08-02.md`
in full first — it has the full background this section only summarizes.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the exact input→output
   contract for what you're building BEFORE writing it. After writing it,
   check the diff against that stated contract — not "does it compile,"
   but "does this actually fire on the real path it claims to fix."
2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
   passing unit test proving a function's isolated output is correct is
   NOT sufficient evidence the fix works — trace the real caller chain
   with actual proof (a live DB query showing a row landed, a real HTTP
   round-trip, not a mock standing in for the whole chain).
3. **Tangent hunt as you walk the workflow.** While touching each file,
   check adjacent call sites and control-flow branches for the same class
   of gap. Report tangents found even if not fixed this pass.

If you cannot complete a full cycle, or find a design gap mid-task, STOP and
report the specific deviation and why, rather than shipping a partial fix
under a "done" label.

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (cite actual command/query output, not
"tests pass") → Tangents found → Deviations flagged (if any) → Skills run
+ findings → Gates (exact output) → Files changed.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
```
