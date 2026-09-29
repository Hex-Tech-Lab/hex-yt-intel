# Agent Dispatch Prompt — Wave 5: Route Security & Selective Re-analyze (ADR 021)

**Target Agent**: OpenCode (OC)
**Model Preset**: `@preset/glm-53-flash-on-cheap` (`glm-5.3-flash`, low effort)
**Provider Order**: `baseten`, `modal` (Strict order, `allow_fallbacks: false`)

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the canonical, authoritative version.**
> Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with intent + target files as your first action; re-check the ledger after every subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually happened as your last action; use the `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.

---

## 1. Context & Objectives

The Lead Architect directed a two-part wave:
1. **Task 1: Secure the Service Role Leak (`web/app/api/analyses/highlights/route.ts`)**:
   - Inspect the queries that execute when `dbClient = serviceClient`.
   - Ensure the downstream `analysis_highlights` query is strictly and non-bypassably bound to `.eq('analysis_id', parsed.data.analysisId)`.
   - Add explicit verification that `parsed.data.analysisId` matched the verified row ID from the `analyses` query, eliminating any chance of IDOR or cross-tenant highlight leakage.

2. **Task 2: ADR 021 (Selective Re-analyze - Phases 2-4)**:
   - **UI**: In `web/components/templates/console/AnalysisHistory.tsx` (and `DashboardContainer.tsx`), provide a "Retry Missing Dimensions" / "Remediate" action when `item.status === 'partial'` or `item.missingDimensions.length > 0`.
   - **API/Worker**: Ensure targeted dimension re-analyze sends the array of missing dimension numbers (`dimensions: item.missingDimensions`) to the analysis kickoff.
   - **DB Merge**: In the Supabase persistence layer (`SupabasePersistenceAdapter.ts` / `update_analysis_result_atomic`), ensure safe JSONB merging preserves existing dimensions rather than clobbering completed ones.

---

## 2. Deliverables & Gate Verification

- Deliver surgical unified diffs.
- Verify `pnpm --filter @hex-yt-intel/web exec tsc --noEmit` exits with 0 errors.
