# Agent Dispatch Prompt — R1b — Dimension 8 sub-dimension epistemic split (Finding 3)

**Target Agent**: OC (opencode) — model `glm-preset/@preset/glm-53-flash-on-cheap` (user server-side preset, Modal-first — CLAUDE.md "OC model standard" v4)
**Effort Level**: high

Source: CC 96-hour audit https://claude.ai/artifact/Le3vAmQY4T5PZhWFFcpFNU. Phase R1 = four SEQUENTIAL dispatches (R1a → R1b → R1c → R1d) on ONE branch `fix/r1-contracts` in ONE worktree `../hex-yt-intel-r1`. Each dispatch commits its own work. Only R1d opens the PR. CC verifies between dispatches.

**Hard rules for every R1 dispatch**
- Work ONLY in `../hex-yt-intel-r1`. NEVER edit, stash, reset, checkout or clean the main checkout `/home/kellyb_dev/projects/hex-yt-intel` (other agents' WIP lives there). The only exception is appending to its `.memory/AGENT_LEDGER.md`.
- Do NOT apply any migration to the live database (no Supabase MCP `apply_migration`, no Management API, no `supabase db push`). Write migration FILES only. CI applies them on merge (ADR 013). Production must keep working until the PR merges.
- Migration filenames: `supabase/migrations/2026092912XXXX_<name>.sql`, strictly increasing, and not colliding with any existing timestamp (`ls supabase/migrations | tail`). Then run `pnpm exec supabase db push --dry-run` if credentials allow it, and paste the output. If they don't, say so.
- **Lessons from R0/R1a/hotfix (2026-09-29), all MANDATORY:**
  - The ONLY valid home path is `/home/kellyb_dev` (UNDERSCORE). `/home/kellyb-dev` or any other path is rejected by the harness and KILLS your run.
  - R1a is already committed on `fix/r1-contracts` (2 commits, rebased on main `ef86a077`). Do NOT recreate the worktree; `cd /home/kellyb_dev/projects/hex-yt-intel-r1` and build on top of it.
  - NEVER delete or weaken an existing test (no loosening `toHaveLength(n)` to `>=`, no removed cases). Only ADD tests or update fixtures whose intent you preserve.
  - NO gate-gaming: no empty `try {} finally {}` blocks, no rewriting code just to dodge a qa-intel rule, no drive-by renames/import reordering/extra logging in lines you were not asked to change, and NEVER edit `scripts/quality-engine/**` or `.qa-intel/baseline.json`. If qa-intel `--compare` reports a PRE-EXISTING finding in a file you touched, list it in the report and STOP there; CC decides. Findings in NEW code you wrote must be fixed properly.
  - Touch ONLY the files the steps name. Before committing, paste `git status --short` and `git diff --stat`.
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

Layer 2 splits bundles into GROUNDED ("Universe of 1", transcript-only) and PROJECTIVE (external knowledge allowed). The quarantined WIP marked ALL of dim 8 as projective. That is wrong: dim 8's KG nodes and relations feed chat grounding (ADR 008) and entity-click timestamp seek (ADR 022, which looks up entity labels in the transcript text). UCIS v5.4 (`web/lib/prompts/ucis-v5.4.ts` ~lines 284-375) defines dim 8 as:
- 8.1 Primary Knowledge Graph Nodes — GROUNDED
- 8.2 Semantic Relations — GROUNDED
- 8.3 Cross-Domain Bridges — PROJECTIVE
- 8.4 Discovery Pathways — GROUNDED (the prompt text says "never looked up externally -- this field is transcript-only")

**User-approved mapping (2026-09-29):**
- Grounded: dims 1-7, 8.1, 8.2, 8.4, 10
- Projective: 8.3, 9, 11

R1a already set `STREAM_BUNDLES` = `[1,10],[2,4,6],[5,7],[3,8],[9,11]` in `../hex-yt-intel-r1` on branch `fix/r1-contracts`.

Reference implementation to PORT FROM (not copy blindly): the quarantined WIP. Read it with `git -C /home/kellyb_dev/projects/hex-yt-intel diff -- web/lib/config/synthesis.ts web/hooks/useSSEStream.ts worker/src/services/PromptBuilder.ts worker/src/routes/analysis.ts worker/src/ports/ReasoningEnginePort.ts`, or from `.memory/wip/2026-09-29-dirty-tree.patch` in the main checkout. It contains: `PROJECTIVE_DIMENSIONS` + `isProjectiveBundle`, the two-phase dispatch in `useSSEStream` (grounded bundles in parallel, then projective), the EPISTEMIC MODE constraint in `PromptBuilder` (placed AFTER the cacheable `sharedPrefix`, so the prompt-cache contract holds), and `prior_payload` plumbing. Port ONLY those hunks. Those files also contain unrelated hunks from other waves (retry/`missingDimensions`, `pipelineMode`). Do NOT port those; list them in the report.

## 2. Contract & Implementation Directives

**Contract (SSOT in `web/lib/config/synthesis.ts`, imported by web AND worker):**
```ts
export const PROJECTIVE_DIMENSIONS: readonly number[] = [9, 11];
export const PROJECTIVE_SUBDIMENSIONS: readonly string[] = ['8.3'];   // produced by the projective bundle
export function isProjectiveBundle(dims: readonly number[]): boolean;  // true iff dims ∩ PROJECTIVE_DIMENSIONS ≠ ∅
```
- A GROUNDED bundle containing dim 8 must produce 8.1, 8.2 and 8.4 ONLY inside dimension 8's content, plus the `knowledgeGraph` extra field. The prompt must tell it explicitly to OMIT 8.3.
- The PROJECTIVE bundle produces dims 9 and 11 AND a top-level extra field `crossDomainBridges: string` (the markdown body of 8.3). It must NOT emit a dimension-8 object.
- Stitch rule (`web/lib/services/stitch-analysis-chunks.ts`, `stitchChunksIntoPayload`): if a chunk carries `crossDomainBridges`, append it to dimension 8's content as a section headed `#### 8.3 Cross-Domain Bridges`. It goes AFTER 8.2 and BEFORE 8.4 if a `#### 8.4` heading exists in the content; otherwise it is appended at the end. Idempotent: never append twice (check for the heading first). If dim 8 is missing, keep `crossDomainBridges` on the payload root and do NOT fabricate a dim 8.
- Dimension presence (reaper, finalize, `buildDimensionStatus`): dim 8 counts as present when the grounded chunk delivered it. A missing 8.3 is NON-fatal and must NOT make a row partial.

Steps, IN ORDER (in `../hex-yt-intel-r1`, on top of R1a's commit):
1. Add the SSOT constants/function above to `synthesis.ts`. Unit-test `isProjectiveBundle` against all 5 target bundles: only `[9,11]` is true.
2. Do NOT add `crossDomainBridges` to any dimension's `extraFields`: 8.3 belongs to no emitted dimension, so the projective bundle's prompt requests it in step 4. Add `crossDomainBridges?: string` to the UCISPayloadV2 schema (`web/lib/validators/synthesis.ts`) as optional. Max length comes from registry key `analysis.layer2.crossDomainBridgesMaxChars` (default 4000, new migration file, pattern `20260927120000_transcript_budget_registry_key.sql`). Over the cap: truncate at the stitch step and log a warning (it is display text, not a security boundary).
3. Port the two-phase dispatch from the WIP `useSSEStream.ts`: grounded bundles run in parallel; the projective bundle starts only after every grounded bundle settles. `priorPayloadOverride` plumbing as in the WIP. Keep the WIP's fallback for when all grounded bundles fail.
4. Port the PromptBuilder EPISTEMIC MODE block (grounded vs projective constraint text, `bundleFallback`, `priorPayloadInstruction`) VERBATIM from the WIP, then add:
   - grounded bundle whose dims include 8: add the line `For DIMENSION 8, produce ONLY sub-sections 8.1, 8.2 and 8.4. OMIT 8.3 Cross-Domain Bridges entirely; it is produced by a separate projective request.`
   - projective bundle: add the line `ALSO produce sub-section 8.3 Cross-Domain Bridges (per the UCIS DIMENSION 8 definition) as a top-level JSON string field "crossDomainBridges". Do NOT emit a dimension-8 object.`, and add `crossDomainBridges` to that bundle's allowed root fields in the "Do NOT include any other JSON root fields" instruction.
   Keep every added line AFTER `sharedPrefix` (inside `segmentInstruction`). `sharedPrefix` must stay byte-identical across all 5 bundles. The existing test `worker/src/__tests__/prompt-cache-request-shape.test.ts` guards this; extend it to assert the grounded dim-8 line and the projective 8.3 line land ONLY in `segmentInstruction`.
5. Worker envelope parsing: find where the worker or persist accepts root fields (`knowledgeGraph`, `classification`, `monetizationVerdict`) — `grep -rn "monetizationVerdict" worker/src web/app/api/analyses/persist web/lib/services` — and allow `crossDomainBridges` through the SAME path. Do not add a new path.
6. Stitch rule from the contract, in `stitch-analysis-chunks.ts`. Tests: (a) 8.4 present → 8.3 inserted between; (b) no 8.4 → appended; (c) stitched twice → one heading; (d) dim 8 absent → root field kept, no dim 8 created; (e) `buildDimensionStatus` reports dim 8 present without 8.3.
7. Commit: `feat(layer2): R1b epistemic split at sub-dimension level (8.3 projective)` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push. STOP and report.

## 3. Pre-PR Review Skills

- STEP 0: `build-graph`; `get_impact_radius_tool` on `stitchChunksIntoPayload`, `buildDimensionStatus`, `PromptBuilder`; `query_graph_tool` tests_for on each.
- ALWAYS: `qa-intel` (both modes), `code-reviewer`, `review-delta`, `review-duplication`, contract-auditor.
- worker/ports/adapters: `type-design-analyzer` (payload schema change), `silent-failure-hunter` if you touch catch blocks.
- web/hooks: `react-best-practices`.
- migrations: `supabase-postgres-best-practices`.

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
1. Contract = the SSOT + stitch rule above. Enforce them with the step 1 and step 6 tests plus the prompt-cache test.
2. E2E: bundle `[3,8]` prompt → LLM envelope (8.1/8.2/8.4 + knowledgeGraph) → persist chunk; bundle `[9,11]` prompt → envelope with crossDomainBridges → persist chunk → stitch → final payload's dim 8 content contains all four sub-sections in order. Prove it with a stitch test that feeds two realistic chunk fixtures.
3. Tangents: chat grounding (ADR 008) and entity seek (ADR 022) read dim 8. Confirm they now read only grounded 8.1/8.2 data (8.3 text sits inside the content markdown; check `findAllEntityMentions` still searches the transcript, not dim content). Also check the dimension-remediation path (`web/lib/services/dimension-remediation.ts`): what happens when dim 8 is missing and it re-requests it? Report; do NOT redesign.

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
