# Agent Dispatch Prompt — R1e: Dimension 8.4 Hybrid Enrichment (8.4 moves to the projective bundle)

**Target Agent**: OC (opencode) — model `glm-preset/@preset/glm-53-flash-on-cheap` (CLAUDE.md "OC model standard" v4)
**Effort Level**: medium

Source: user/Orchestrator directive 2026-09-29 (product-level contract amendment), after R1 (#363, merge 11fcc920).

**Hard rules — MANDATORY (lessons 2026-09-29):**
- The ONLY valid home path is `/home/kellyb_dev` (UNDERSCORE). `/home/kellyb-dev` or any other path is rejected and KILLS your run.
- Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-r1e` (step 1 creates it). Never touch the main checkout except appending to its `.memory/AGENT_LEDGER.md`. Never read `~/.claude` or another agent's files.
- NEVER run `git stash`, `git reset`, `git checkout -- <file>` or `git clean`. To compare with the base, use `git diff` or `git show HEAD:<file>`.
- NEVER delete or weaken an existing test. You may UPDATE an assertion only where this contract deliberately changes behaviour, and you must name each one in the report.
- NO gate-gaming: no empty `finally` blocks, no rewrites just to dodge a rule, no drive-by renames/import moves/extra logging, and NEVER edit `scripts/quality-engine/**` or `.qa-intel/baseline.json`. If qa-intel reports a PRE-EXISTING finding in a touched file, list it and STOP; CC decides. Findings in code you wrote: fix them properly.
- Do NOT run `supabase db push`, `supabase link` or anything that sources `.env*` files. No migration is needed for this task.
- Touch ONLY the files named below. Paste `git status --short` and `git diff --stat` before committing.

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

R1b (merged) split dimension 8 at sub-dimension level: grounded bundle `[3,8]` produces 8.1, 8.2 and 8.4; projective bundle `[9,11]` produces 8.3 as root field `crossDomainBridges`, which `stitchChunksIntoPayload` inserts into dim 8. The user has now upgraded **8.4 Discovery Pathways** to a HYBRID feature: it reports what the speaker named AND recommends external resources. Anything that uses external knowledge must run in the projective bundle.

**New mapping:** grounded = 1-7, 8.1, 8.2, 10. Projective = 8.3, **8.4**, 9, 11. Bundle MAP UNCHANGED: `[1,10],[2,4,6],[5,7],[3,8],[9,11]`.

## 2. Contract & Implementation Directives

**Contract.**
- Grounded bundle containing dim 8: dim 8 content has ONLY 8.1 and 8.2. It ALSO emits a root field `explicitSpeakerResources: string[]`: resources/tools/further reading the speaker EXPLICITLY names in the transcript, verbatim-ish, max 20 items, each max 200 chars, `[]` if none. It writes NO 8.4 markdown.
- Projective bundle: emits `crossDomainBridges` (8.3, unchanged) AND a new root field `discoveryPathways` (the 8.4 markdown), written per the new UCIS 8.4 text below, using the `explicitSpeakerResources` it receives in prior_payload as the "explicitly named" list.
- Client grounded→projective handoff (`buildGroundedPriorPayload` in `web/hooks/useSSEStream.ts`): add `explicitSpeakerResources` (from the nucleus/adapter state of the grounded chunk) to the payload handed to `fitPriorPayloadToCap`.
- `web/lib/config/prior-payload.ts`: `PriorPayloadSchema` gains OPTIONAL `explicitSpeakerResources: z.array(z.string().max(200)).max(20)`. It stays `.strict()`. `validatePriorPayload` and `fitPriorPayloadToCap` carry it through, and it counts toward the byte cap. When trimming, drop resources BEFORE trimming dimension content.
- Stitch (`web/lib/services/stitch-analysis-chunks.ts`): dim 8 content becomes 8.1, 8.2 (grounded), then `#### 8.3 Cross-Domain Bridges`, then `#### 8.4 Discovery Pathways`, appended in that order. Each is idempotent (never inserted twice) and capped (`discoveryPathways` reuses the same `truncateBridges`-style cap + registry key `analysis.layer2.crossDomainBridgesMaxChars`; do NOT add a new key). If dim 8 is missing, both stay on the payload root. The old "insert 8.3 before an existing 8.4 heading" rule now only matters for legacy rows; keep it working.
- `explicitSpeakerResources` must NOT survive into the persisted payload (it is an intermediate). Strip it at stitch.

**UCIS v5.4 text (`web/lib/prompts/ucis-v5.4.ts`, lines ~361-368).** Replace the current `#### 8.4 Discovery Pathways` section body with EXACTLY this text (user-approved, do not paraphrase):
```
#### 8.4 Discovery Pathways
First, list any resources, tools, or further reading the speaker explicitly names in the transcript (based purely on the grounded extraction). If the speaker names none, state: 'No resources explicitly named by speaker.'
THEN, regardless of whether the speaker named any, utilize your external knowledge to recommend 2-3 highly relevant, cross-domain discovery pathways (books, research, websites) ranked by relevance. Briefly justify why each external recommendation expands on the content's core thesis.
```
Note: this text is inside the cacheable `sharedPrefix`, so changing it changes the prompt-cache identity once. That is expected. Do NOT move it.

Steps, IN ORDER:
1. `git -C /home/kellyb_dev/projects/hex-yt-intel fetch origin && git -C /home/kellyb_dev/projects/hex-yt-intel worktree add /home/kellyb_dev/projects/hex-yt-intel-r1e -b feat/r1e-dim84-hybrid origin/main && cd /home/kellyb_dev/projects/hex-yt-intel-r1e && pnpm install --frozen-lockfile`
2. `web/lib/config/synthesis.ts`: `PROJECTIVE_SUBDIMENSIONS = ['8.3', '8.4']`; update its JSDoc mapping line to the new mapping.
3. UCIS text replacement (above). Update any UCIS test asserting the old 8.4 text (`web/lib/prompts/__tests__/ucis*`); name each in the report.
4. `worker/src/services/PromptBuilder.ts`: grounded dim-8 omission line now says produce ONLY 8.1 and 8.2, omit 8.3 AND 8.4, and emit the root array `explicitSpeakerResources` (max 20 items). The projective instruction adds `discoveryPathways` (8.4 markdown under `#### 8.4 Discovery Pathways`) next to `crossDomainBridges`, and the "no other JSON root fields" line names BOTH allowed root fields for projective, and `explicitSpeakerResources` for a grounded bundle containing dim 8. Keep everything after `sharedPrefix`.
5. Worker schema (`worker/src/services/ZodSchemas.ts`) and web validators (`web/lib/validators/synthesis.ts`): optional `discoveryPathways` string and optional `explicitSpeakerResources` string array (max 20, each max 200), following the existing `crossDomainBridges` entry exactly.
6. `web/lib/config/prior-payload.ts` + `useSSEStream.ts` handoff (contract above).
7. Stitch changes (contract above).
8. Tests (ADD, don't weaken):
   - prior-payload: schema accepts resources; rejects 21 items or a 201-char item; fit drops resources before trimming content.
   - stitch: 8.1 → 8.2 → 8.3 → 8.4 order; idempotent; `explicitSpeakerResources` absent from the stitched payload; legacy row whose grounded dim 8 already has an 8.4 heading still gets 8.3 inserted before it.
   - PromptBuilder shape test (`worker/src/__tests__/prompt-cache-request-shape.test.ts`): the grounded dim-8 line mentions `explicitSpeakerResources`; the projective line mentions `discoveryPathways`; both stay out of `sharedPrefix`. (This test cannot run locally; say so.)
   - UCIS: the exact new 8.4 text is present.
9. NEGATIVE CONTROL: revert only the stitch 8.4 insertion, run the stitch tests, paste the failure, restore.
10. Gates (paste real output, all exit 0): web tsc; worker tsc (`-p tsconfig.typecheck.json`); web vitest (full); web lint; `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare` AFTER `git add` of your files (the scanner only sees tracked files); `pnpm --filter youtube-intelligence-worker run build`.
11. Commit: `feat(layer2): R1e dimension 8.4 hybrid enrichment (projective)` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push. STOP and report.

## 3. Pre-PR Review Skills
- STEP 0: `build-graph`; `get_impact_radius_tool` on `stitchChunksIntoPayload`, `PromptBuilder`, `fitPriorPayloadToCap`.
- ALWAYS: `qa-intel` (both modes), `code-reviewer`, `review-delta`.
- worker/ports: `type-design-analyzer` (schema change).

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

Scoped checklist:
1. Contract = the mapping + field contract above, enforced by the step 8 tests.
2. E2E: grounded `[3,8]` prompt → envelope with 8.1/8.2 + `explicitSpeakerResources` → client handoff → prior_payload (validated, capped) → projective `[9,11]` prompt → envelope with `crossDomainBridges` + `discoveryPathways` → stitch → dim 8 = 8.1..8.4, no intermediate field persisted.
3. Tangents: chat grounding (ADR 008) and entity seek (ADR 022) now see 8.4 markdown containing EXTERNAL recommendations inside dim 8. Check whether either treats dim 8 content as grounded evidence, and REPORT it (do not redesign).

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
