# Agent Dispatch — Entity Mention Index: Significance Scoring, Persistence, Segment Boundaries (OC)

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> Follow `AGENTS.md`/`CLAUDE.md` §2 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.

**A sibling agent (AGY, on Gemini) is dispatched IN PARALLEL, at the same
time as you, to build the UI layer (timeline scrubber, forward/back
navigation, auto-segment playback controls) that CONSUMES the data you are
building here. Read §2's "Frozen contract" section carefully — that exact
TypeScript shape is what AGY's prompt was also given, verbatim, identical.
Do not change field names, types, or semantics from what's specified there
without posting a `[NOTE]` to the ledger flagging the change, since AGY is
building against this exact shape without waiting for your implementation
to land.**

## 1. Context

hex-yt-intel: Next.js/React 19/Zustand web app + Cloudflare Worker + Supabase.
Entity-click video seeking currently works (fixed 2026-08-08, PR #222): click
an entity in the Word Cloud/Mind Map/Knowledge Graph panels, it finds the
nearest textual mention of that entity across the analysis's dimensions and
seeks the video there. That fix is the CORRECTNESS floor — this task is a
substantial feature UPGRADE on top of it, driven by product direction
(internal ADR doc — ADR 025, private, ask the orchestrator if you need more
context than what's inlined below; you likely cannot read it directly since
it lives in a gitignored path not present in your worktree).

**The upgrade, in plain terms**: today, clicking an entity finds exactly ONE
mention (nearest to wherever the video currently is) and seeks to it, with no
way to see or reach the entity's OTHER mentions, no ranking by how
significant each mention is, and no bounded playback (it just resumes normal
continuous playback from that point). The target experience: click an
entity → get a RANKED LIST of its mentions (most significant first, not
nearest-to-playhead first) → a UI (built by the sibling agent) lets the user
step through them and auto-play each one as a bounded segment (play only
that mention's segment, then auto-advance to the next, not continuous
playback).

**Your job is the data/backend half of this**: given an entity, produce a
ranked list of ALL its mentions across ALL dimensions, each with a
significance score and a bounded start/end segment (not just a single
timestamp), and persist this once per analysis so it's available immediately
without recomputing on every click.

## 2. Task

### Frozen contract — [DO NOT MODIFY WITHOUT A LEDGER NOTE]

This exact shape must be what your implementation produces, and it's the
exact shape AGY's UI is being built against, in parallel, right now:

```typescript
/** One ranked, segment-bounded mention of an entity, replacing the single
 *  EntityMentionMatch the current (pre-upgrade) code returns. */
export interface RankedEntityMention {
  /** Existing field, unchanged semantics from EntityMentionMatch. */
  timestamp: string; // "MM:SS" or "HH:MM:SS", display form
  seekSeconds: number; // parsed start time in seconds
  occurrenceIndex: number; // existing field, unchanged semantics

  /** NEW: segment end, in seconds -- where auto-play should stop and
   *  advance to the next mention. Must be > seekSeconds. See §2 Step 2
   *  for how to derive this (sentence/paragraph-boundary heuristic). */
  segmentEndSeconds: number;

  /** NEW: 0-100 significance score, higher = more significant. Mentions
   *  in the returned array MUST be sorted by this field descending
   *  (most significant first), NOT by seekSeconds/occurrenceIndex. */
  significance: number;

  /** NEW: which dimension this mention was found in (for debugging/
   *  telemetry -- not required for the UI to function, but include it). */
  dimensionNumber: number;
}

/** Full ranked index for one entity -- what gets persisted per-node. */
export interface EntityMentionIndex {
  nodeId: string; // matches GraphNode.id
  mentions: RankedEntityMention[]; // sorted by significance descending, see above
}
```

### Step 0 — mandatory pre-flight (read before touching anything)

1. **code-review-graph MCP, Step 0 before Grep/Glob/Read** (per this repo's
   CLAUDE.md mandate): run `build_or_update_graph_tool()` first, then
   `get_review_context_tool()`/`get_impact_radius_tool()` scoped to the files
   named in §5 below. This project has a knowledge graph specifically so you
   don't have to cold-read whole files — use it before falling back to Grep.
2. **Skim-then-expand contextual pass**: before writing any code, read (at
   minimum, skim first, then expand into full reads for the ones you'll
   actually modify) these files in full, in this order, so you understand
   the existing mechanism you're extending, not just this prompt's summary
   of it:
   - `web/lib/utils/entity-time-seek.ts` (the existing single-mention logic
     you are extending, not replacing — `findAllEntityMentions` already does
     90% of the "find every mention" work; you're adding scoring + segment
     bounds + a persisted-once-not-recomputed-every-click storage layer on
     top of it, not rewriting the text-matching logic from scratch).
   - `web/lib/intelligence/knowledge-graph.ts` (the existing
     `KnowledgeGraphSynthesizer` — it ALREADY computes TF-IDF distinctiveness
     scores for entities; you should reuse this machinery for mention-level
     significance, not build a second, separate TF-IDF implementation).
   - `web/lib/types/synthesis-nucleus.ts` (the `UCISPayload`/`analyses`
     persistence shape — this is where the new index needs to live).
   - `web/components/containers/DashboardContainer.tsx`'s `handleSelectNode`
     (the current single-mention consumer you're generalizing beyond).
   - `worker/src/routes/analysis.ts` (where analysis-completion persistence
     already happens, for the write path).

### Step 1 — Significance scoring (TF-IDF + duration heuristic, hybrid)

For each entity mention found by (an extended version of)
`findAllEntityMentions`, compute a significance score using BOTH of:

1. **TF-IDF distinctiveness** — reuse `KnowledgeGraphSynthesizer`'s existing
   TF-IDF machinery (do not reimplement it) to score how distinctive the
   sentence/paragraph SURROUNDING each mention is, relative to the rest of
   the dimension's content.
2. **Local discussion density** — how long the entity keeps being discussed
   after this specific mention (e.g. sentence count until a topic shift, or
   paragraph length) — a simple, explainable heuristic, not another ML
   model.

Combine into a single 0-100 `significance` score (design the exact weighting
formula yourself, document your reasoning in a code comment, and make it
adjustable via a couple of named constants rather than magic numbers baked
into the formula — per this repo's "no hardcoded magic numbers" convention,
check whether these constants belong in the Settings Registry the same way
other tunables in this codebase do, e.g. `web/lib/config/synthesis-with-settings.ts`
for the pattern other dimension-related tunables already follow).

### Step 2 — Segment boundaries

For each mention, derive `segmentEndSeconds`: the point where this specific
discussion of the entity naturally ends (next sentence/paragraph boundary,
or the next OTHER timestamp marker in the source text, whichever is closer)
— not simply "start of next mention" (a single mention's segment must not
swallow unrelated content that follows it). Cap segment length at a
reasonable maximum (e.g. 30-45 seconds) even if the natural boundary is
further out — again, make this a named, documented constant, not a magic
number, and check whether it should be a Settings Registry key.

### Step 3 — Persistence (compute once, at analysis completion, not per-click)

Persist the full `EntityMentionIndex[]` (one per graph node) as part of
analysis completion, NOT computed fresh on every click. Follow the existing
pattern other completion-time artifacts (`knowledgeGraph`, `classification`)
already use for how they get computed server-side and attached to the
persisted analysis record — trace exactly where those currently get set
(likely in `worker/src/routes/analysis.ts` or a service it calls) and add
this alongside them, not as a separate bolt-on mechanism. This needs a
migration if it's a new column — follow ADR 018's mandatory process (`list_migrations`
immediately after `apply_migration`, rename the local file to match the
server-recorded timestamp exactly) if you add one.

### Step 4 — Wire the new data into the existing seek entry point

`DashboardContainer.tsx`'s `handleSelectNode` currently calls
`findNearestEntityMentionAcrossDimensions` and gets back a single
`EntityMentionMatch`. Add a new consumer path (a new exported function,
`getRankedMentionsForEntity` or similar, in `entity-time-seek.ts`) that
returns the full `EntityMentionIndex` for a clicked node — reading the
PERSISTED index from Step 3 when available, falling back to computing it
live (reusing the same scoring logic) when the persisted index isn't there
yet (e.g. for an analysis that predates this feature). Do NOT remove or
break the existing single-mention `findNearestEntityMentionAcrossDimensions`
path — the sibling UI agent's simplest-case fallback and any other existing
caller may still depend on it; this is additive.

## 3. Goal / definition of done

- Clicking an entity (via the new `getRankedMentionsForEntity` path) returns
  a real `EntityMentionIndex` with 2+ real, correctly-ranked
  `RankedEntityMention` entries for an entity known to have multiple
  mentions in a real analysis — verified against actual data, not a
  synthetic unit-test fixture alone.
- The index is persisted once at analysis completion and reused on
  subsequent clicks/reloads without recomputation — verified via a real DB
  query showing the persisted column/field populated after a real analysis
  completes.
- The exact `RankedEntityMention`/`EntityMentionIndex` shapes in §2 are
  unchanged from what's specified here (or a `[NOTE]` was posted to the
  ledger if a change was genuinely necessary, and AGY was informed).

## 4. Expected results

- Modified: `web/lib/utils/entity-time-seek.ts` (new exports, existing
  exports unchanged), `web/components/containers/DashboardContainer.tsx`
  (new consumer path added, existing path untouched), wherever analysis
  completion persistence lives (`worker/src/routes/analysis.ts` and/or a
  service it calls), possibly a new migration.
- New tests covering: significance ranking order (most significant first,
  not nearest-to-playhead), segment boundary derivation (capped length,
  doesn't swallow unrelated content), persistence round-trip.
- A PR opened via the `/pr-review-workflow` skill, branch
  `feat/entity-mention-index-adr025`, targeting `main`. **Do not merge —
  the orchestrator (CC) reviews both this and the sibling AGY PR together
  for synchronization before either merges.**

## 5. Task-specific skills/tools/MCPs

`/pr-review-workflow` skill (explicitly invoke it — don't paraphrase its
process from memory, re-read it fresh). CORE (qa-intel, contract-auditor,
`/simplify`) always. SELECT: `supabase-postgres-best-practices` if a
migration is added (check index coverage on any new query pattern);
`react-best-practices` if `DashboardContainer.tsx`'s consumer path touches
rerender-sensitive state (it likely does — this is exactly `rerender-`
category territory, check the live SELECT trigger table in
`.claude/skills/pr-review-workflow` fresh, don't recall from memory).
`code-review-graph` MCP as Step 0 (see §2 above — mandatory, not optional).

## 6. Fixtures

**[ALWAYS INCLUDE]**: `code-review-graph`'s `build_or_update_graph_tool()`
then `get_review_context_tool()`/`get_impact_radius_tool()` scoped to the
files in §2 Step 0, before any Grep/Glob/Read fallback.

**[FILL IN]**: Start from `main` (check `git log -1` for current tip before
starting — other work has been landing on this branch throughout the day).
Read `web/lib/__tests__/entity-time-seek.test.ts` as the established test
pattern to follow for the new tests.

## 7. The three tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
>    contract for what you're building BEFORE writing it. After writing it,
>    check the diff against that stated contract — not "does it compile,"
>    but "does this actually fire on the real path it claims to fix."
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
>    passing unit test proving a function's isolated output is correct is
>    NOT sufficient evidence the fix works — trace the real caller chain
>    with actual proof (a live DB query showing a row landed, a real HTTP
>    round-trip, not a mock standing in for the whole chain).
> 3. **Tangent hunt as you walk the workflow.** While touching each file,
>    check adjacent call sites and control-flow branches for the same class
>    of gap. Report tangents found even if not fixed this pass.
>
> **If you cannot complete a full cycle, or find a design gap mid-task,
> STOP and report the specific deviation and why, rather than shipping a
> partial fix under a "done" label.**

## 8. Report format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (cite actual command/query output, not
> "tests pass") → Tangents found → Deviations flagged (if any) → Skills run
> + findings → Gates (tsc/vitest/qa-intel `--ci --compare`/contract-auditor
> results, exact output) → Files changed. CC independently re-verifies every
> claim against real code and real system state before accepting — a report
> claiming "done" without this structure, or without E2E proof, will be
> rejected and sent back.

## 9. Gates — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' on output, empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # THE EXACT CI FLAGS
pnpm tsx web/scripts/contract-auditor.ts
```
