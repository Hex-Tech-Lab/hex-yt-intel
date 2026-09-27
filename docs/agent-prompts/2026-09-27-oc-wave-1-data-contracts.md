# Agent Dispatch Prompt — Wave 1: Data Contracts & Persistence Invariants

> **Before filling in Target Agent/Effort below**: check CLAUDE.md's
> "Model/task-fit routing" table — narrow well-scoped fix → OC's cheap default.

**Target Agent**: OC (OpenCode)
**Model**: `glm-preset/@preset/glm-53-flash-on-cheap` (GLM 5.3 Flash)
**Effort Level**: low
**Provider Routing**: `baseten, morph, together` (order-preserving, `allow_fallbacks: false`)

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

---

## 1. Context & Problem Statement

Recent 48-hour forensic audit exposed three critical data persistence and contract drift bugs at the backend/database boundary:

1. **Shell-Row Cache Hit False-Positive (`SupabaseAnalysisAdapter.ts`)**:
   `findCachedAnalysis` excludes `billing_status = 'processing'` and `'failed'`, but omitted `'cancelled'`. Furthermore, when checking `analysis_payload`, any row containing only aux data (e.g. `analysis_payload = { stance_relations: { ... } }`) passed `Object.keys().length > 0`, returning a cache hit with 0 dimensions and empty markdown. This triggers client crashes (`ERR_RESTORE_UNUSABLE`).
2. **`stance_relations` Overwritten During Chunk Stitching (`stitch-analysis-chunks.ts` & `persist/route.ts`)**:
   When chunk 5 completes, `persist/route.ts` calls `stitchChunksIntoPayload(chunkMap, resolvedTotal, extraMetadata)`. `extraMetadata` omits `stance_relations`, and `stitchChunksIntoPayload` does not preserve it, completely erasing ADR 031 stance relations on chunk-5 finalization and reaper recovery.
3. **Knowledge Graph Cap Desynchronization (`ZodSchemas.ts` vs `synthesis.ts`)**:
   Commit `c4125116` bumped `MAX_KG_EDGES` in `web/lib/validators/synthesis.ts` to 24 while worker `ZodSchemas.ts` remained at 18. Per the ROE (RAGraph Ontological Engine) reference architecture documented in `docs/private/html/2026-08-17-SYNTHESIS-cross-article-findings.html:102`, the hard caps are `≤ 24 nodes` and `≤ 18 edges`. Both systems must align at `MAX_KG_NODES = 24` and `MAX_KG_EDGES = 18`, with slice-clamping applied before validation so outputs with excess edges are gracefully truncated to 18 rather than dropping the payload.

---

## 2. Contract & Implementation Directives

Work on branch `fix/wave-1-data-contracts`.

### Step 1: Fix `SupabaseAnalysisAdapter.ts`
File: `web/lib/adapters/SupabaseAnalysisAdapter.ts`
1. In `findCachedAnalysis`, add `.neq('billing_status', 'cancelled')` to the query chain.
2. In the `existing.analysis_payload` branch, verify that the extracted dimensions or markdown represent usable content:
   ```typescript
   const hasContent = Object.keys(dimensions).length > 0 || (typeof existing.analysis_markdown === 'string' && existing.analysis_markdown.trim().length > 100);
   if (!hasContent) return null;
   ```
3. Add a unit test in `web/lib/__tests__/supabase-analysis-adapter-cache.test.ts` verifying that shell rows with 0 dimensions and empty markdown return `null`.

### Step 2: Preserve `stance_relations` in S2S Stitching
Files: `web/lib/services/stitch-analysis-chunks.ts`, `web/app/api/analyses/persist/route.ts`
1. In `web/app/api/analyses/persist/route.ts` (both line ~954 chunk-completion and line ~1268 partial-stitch), pass `stance_relations: priorPayload?.stance_relations ?? null` in `extraMetadata`.
2. In `web/lib/services/stitch-analysis-chunks.ts`:
   - Update `extraMetadata` type to include `stance_relations?: any`.
   - In `stitchedPayload`, add:
     ```typescript
     ...(extraMetadata?.stance_relations ? { stance_relations: extraMetadata.stance_relations } : {}),
     ```
   - In the chunk loop (lines 135-165), also capture `if (chunkPayload.stance_relations && !stitchedPayload.stance_relations)` if any chunk carries it.

### Step 3: Align Knowledge Graph Caps to ROE Standard (24 Nodes / 18 Edges)
Files: `web/lib/validators/synthesis.ts`, `worker/src/services/ZodSchemas.ts`, `web/lib/services/stitch-analysis-chunks.ts`
1. In `web/lib/validators/synthesis.ts`:
   - Set `export const MAX_KG_NODES = 24;`
   - Set `export const MAX_KG_EDGES = 18;`
   - In `KnowledgeGraphSchema` and `UCISStreamFragmentSchema` (type "kg"), ensure `.slice(0, MAX_KG_EDGES)` is applied in preprocessing or normalization so incoming arrays of edges are clamped to 18 rather than failing schema validation.
2. In `worker/src/services/ZodSchemas.ts`:
   - Verify `export const MAX_KG_NODES = 24;`
   - Set `export const MAX_KG_EDGES = 18;`
3. In `web/lib/services/stitch-analysis-chunks.ts`:
   - Ensure `stitchedNodes` is sliced to `MAX_KG_NODES` (24) and `stitchedEdges` is sliced to `MAX_KG_EDGES` (18).

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

- **ALWAYS**:
  - `qa-intel` — run `--mode diff` and `--mode full`
  - `contract-auditor`: `pnpm exec tsx web/scripts/contract-auditor.ts`
  - `simplify`
- **IF `web/app/api/**` | `*ports*` | `*adapters*` | `worker/**`**:
  - `pr-review-toolkit:type-design-analyzer`
  - `pr-review-toolkit:silent-failure-hunter`
  - `race-condition-guard`

---

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter youtube-intelligence-worker build
pnpm --filter @hex-yt-intel/web exec vitest run lib/__tests__/contracts/
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```

---

## 5. The Three Tenets — [ALWAYS INCLUDE]

> 1. **Contract definition + enforcement.** State the exact input→output contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
