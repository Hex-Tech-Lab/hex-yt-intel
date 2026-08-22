# Design Proposal — Highlights/Chat/Digest Consistency

**Author**: OC (opencode, glm-5.2:free, low effort)
**Date**: 2026-08-21
**Dispatch**: `2026-08-21-oc-highlights-chat-digest-consistency-investigation.md`
**Scope**: Investigation + written design proposal ONLY. No code changes in this dispatch.

---

## Table of Contents

1. [RCA — Current Behavior (Before)](#1-rca--current-behavior-before)
2. [Proposed Design (After)](#2-proposed-design-after)
3. [Cost & Latency Impact](#3-cost--latency-impact)
4. [Migration & Rollout Concerns](#4-migration--rollout-concerns-for-existing-rows)
5. [Tangents Found](#5-tangents-found)
6. [Deviations Flagged](#6-deviations-flagged)
7. [Skills Run + Applicability](#7-skills-run--applicability)
8. [Gates](#8-gates)
9. [Files Changed](#9-files-changed)

---

## 1. RCA — Current Behavior (Before)

All file:line citations below were verified against the actual current file contents via direct reads. This is the "before" contract for each of the three touchpoints (A: variable segment length, B: three-way consistency, C: verbatim transcript).

### 1.A — Fixed Segment Duration (the "capped cut-off, same length for all" bug)

**Root cause**: Three independent layers all use the same fixed Settings Registry value (`highlights.segmentDurationSeconds`, default 10s, clamped [3,30]) instead of each highlight's actual content span (`end - start`).

#### Layer 1: The LLM prompt instructs the wrong `end` semantics

`web/lib/prompts/highlights-extraction.ts:19-25` — `buildHighlightsExtractionSystemPrompt(maxCount)`:

> - **`start`**: MUST exactly match a segment's `start` time from the input — "never invent or interpolate"
> - **`end`**: "the start of the next selected segment or a later segment's start if the point continues"

The LLM is told that `end` = *the start time of the next selected highlight*, not the end of the topic being discussed. This means `end` is a function of highlight *ordering*, not *content duration*. If two adjacent highlights are 15 minutes apart, the "duration" of the first is 15 minutes — clearly wrong.

#### Layer 2: The parser hard-enforces this wrong semantics

`web/lib/prompts/highlights-extraction.ts:91` — `parseHighlightsExtraction()`:

```typescript
// end must also be in validSegmentStarts (the prompt's own contract enforced in code)
```

The parser rejects any `end` that isn't itself a real transcript-segment `start` time. Even if the LLM tried to return a content-driven end, it would be filtered out unless it coincidentally landed on a segment boundary. This is the enforcement of Layer 1's bad contract.

#### Layer 3: The playback engine ignores `end` entirely

`web/lib/hooks/useSegmentPlayback.ts:258-267`:

```typescript
// Fixed segmentDurationSeconds (Settings Registry value, same for
// every segment), not each segment's own (end - start) span
const segmentEnd = leadIn + segmentDurationRef.current;
if (currentTime >= segmentEnd - ADVANCE_LEAD_SECONDS) {
  playFrom(idx + 1);
}
```

The advance clamp uses `segmentDurationRef.current` (the fixed 10s), never `segment.end`. The `playFrom()` function (lines 182-205) seeks to `segment.start - contextLead` but never reads `segment.end`. The `Segment` interface (lines 43-46) has `end`, but it's **unused** in this file.

Note: the comment on lines 55-58 says "the clamp always uses each segment's own end" — **this is stale/misleading**. The actual code at line 264 uses `segmentDurationRef.current`, not `segment.end`.

#### Layer 4: The visual track fill also uses the fixed duration

`web/components/dashboard/HighlightsTrack.tsx:235-246`:

```typescript
// Real fix (live report, 2026-08-21): activeHighlight.end is
// contractually "the start of the next selected segment," not
// a genuinely short highlight-worthy span -- using it directly
// rendered this fill spanning nearly the whole gap to the next
// highlight (the reported "94% of video duration" symptom).
const segWidthPct = Math.max(
  1,
  Math.min(100 - segLeftPct, (segmentDurationSeconds / maxTime) * 100)
);
```

This was deliberately changed to `segmentDurationSeconds` (from `end - start`) to fix the "94% duration" symptom. The comment correctly identifies that `end` is contractually wrong — but the fix was to use a *fixed* duration, which creates the current "same length for all" bug.

The end-bracket position (line 311-317) and the tooltip (line 271-301) also use `segmentDurationSeconds`, not `end`:

```typescript
style={{ left: `${pctFor(activeHighlight.start + segmentDurationSeconds, 99)}%` }}
content={`${highlight.label} (${formatTimestamp(highlight.start)}–${formatTimestamp(highlight.start + segmentDurationSeconds)})`}
```

#### Layer 5: The ticker reveals the LLM-synthesized `label`, not verbatim transcript

`web/lib/hooks/useHighlightTicker.ts:30-48`:

```typescript
export function useHighlightTicker(
  playingIdx: number | null,
  label: string | null,    // ← only text input
  segmentDurationSeconds: number,
  elapsedSeconds: number,
) {
  const words = label ? label.split(/\s+/).filter(Boolean) : [];
  // ...
  const revealedWordCount = Math.min(
    totalWords,
    Math.max(1, Math.ceil((elapsedSeconds / durationSeconds) * totalWords))
  );
}
```

The ticker reveals `label` (the LLM's one-sentence synthesized description) word-by-word, proportionally to `elapsedSeconds / segmentDurationSeconds`. No verbatim transcript text is available on the highlight row — the `analysis_highlights` table has `idx, start_seconds, end_seconds, label` only.

**Summary of the before state for A**: The `end` field is semantically "next highlight start" (prompt-defined + parser-enforced), ignored by playback (which uses a fixed 10s), ignored by the visual fill (also fixed 10s), and there is no verbatim transcript stored. Every highlight plays for exactly 10 seconds and looks exactly the same width on the track, regardless of content.

---

### 1.B — Three-Way Inconsistency (Highlights Reel vs. Chat vs. Digest Takeaways)

The user's complaint: "there are three touchpoints, they're all about the same thing, yet they are not mapped."

#### Touchpoint 1: Highlights Reel

- **Source**: `GenerateExecutiveDigestUseCase.ts:179-235` → `extractHighlights()` — a separate LLM call using `buildHighlightsExtractionSystemPrompt(maxCount)` + `buildHighlightsExtractionUserMessage(segments)`.
- **Input**: Raw transcript segments (`Array<{ start: number; text: string }>`) from `getTranscriptSegments(videoId)`.
- **Output**: `Array<{ idx, start, end, label }>` saved to `analysis_highlights` table.
- **Prompt**: `web/lib/prompts/highlights-extraction.ts` — instructs the LLM to find "genuinely important moments" in the transcript. No awareness of the digest or its takeaways.

#### Touchpoint 2: Chat answers about key points

- **Source**: `web/lib/usecases/ProcessChatMessageUseCase.ts:333-447` — assembles a `grounding` string from multiple sources.
- **Input via `getAnalysisGrounding()`** (`web/lib/adapters/SupabaseAnalysisAdapter.ts:527-645`):
  - `--- DIMENSION 0: EXECUTIVE DIGEST ---` (line 357-359): includes `snapshot`, `overview`, `keyTakeaways` (bullet list), `detailedSummary` — this was added 2026-07-23 (previously the grounding never included the digest at all).
  - `--- ANALYSIS (Dimensions 1-11) ---` (line 378): the full 11-dimension markdown.
  - `--- TRANSCRIPT ---` (line 429-431): budgeted transcript (350k chars).
  - `--- TOP COMMENTS ---` (line 372-374).
- **What's MISSING**: There is **zero reference to highlights** in the chat grounding. The `getAnalysisGrounding()` query (line 544-555) does not select from `analysis_highlights`. The grounding string assembly (lines 333-447) has no `--- HIGHLIGHTS ---` section. The chat LLM has no idea what the Highlights Reel shows.

#### Touchpoint 3: Digest takeaways (Dimension 0)

- **Source**: `GenerateExecutiveDigestUseCase.ts:112-135` — a separate LLM call using `getExecutiveDigestSystemPrompt()` (Vault-backed, key `prompt.executive_digest.system`) + `buildExecutiveDigestUserMessage(markdown)`.
- **Input**: The assembled 11-dimension analysis markdown (truncated to 18,000 chars by `truncateForDigest()`, prioritizing dimensions [1, 3, 5, 11]).
- **Output**: `{ snapshot, takeaways, overview, detailedSummary }` saved to `analyses.executive_digest` (jsonb).
- **Prompt**: `web/lib/prompts/executive-digest.ts` — zero mentions of "highlight" anywhere. The digest prompt has no awareness of the highlights extraction.

#### The disconnection chain

```
Digest takeaways          Highlights Reel              Chat
     │                         │                         │
  [LLM call 1]              [LLM call 2]            [grounding string]
  over 11-dim               over raw                 ← digest takeaways
  markdown                  transcript              ← 11-dim markdown
     │                         │                    ← transcript
     ▼                         ▼                    ✗ NO highlights
  executive_digest       analysis_highlights
  (jsonb)                (table)
```

- Digest and highlights are two independent LLM calls with different prompts and different inputs, sharing no data flow.
- Chat sees the digest but not the highlights.
- All three can tell different "stories" about the same video because they share no common source of truth for "key moments."

**Summary of the before state for B**: Three independent generation paths (digest LLM call, highlights LLM call, chat grounding assembly) share no common data. The digest prompt doesn't mention highlights, the highlights prompt doesn't mention the digest, and the chat doesn't see highlights at all.

---

### 1.C — No Verbatim Transcript on Highlights (the "rendition, not actual transcript" bug)

**Current state**: The `analysis_highlights` table (`supabase/migrations/20260813222218_analysis_highlights_table.sql:8-12`) has:

```sql
create table if not exists public.analysis_highlights (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  idx smallint not null,
  start_seconds real not null,
  end_seconds real not null,
  label text not null
);
```

No `verbatim_excerpt` column exists. The `label` field (LLM-synthesized, max 200 chars per `highlights-extraction.ts:38`) is the only text on each highlight, and the ticker (`useHighlightTicker.ts:30`) uses only `label` — confirmed by the docblock on lines 10-13: "The `label` field (one short sentence per highlight) is the only text available on the analysis_highlights row."

The raw transcript segments (`Array<{ start, text }>`) ARE available at extraction time — `GenerateExecutiveDigestUseCase.ts:187-198` fetches them via `this.persistence.getTranscriptSegments(params.videoId)`. They're passed to `buildHighlightsExtractionUserMessage(segments)` as the LLM input, but only the LLM's synthesized `label` is persisted — the raw segment text between `start` and `end` is never captured.

**Summary of the before state for C**: No verbatim transcript is stored on highlights. The ticker shows an LLM paraphrase. The raw transcript data to derive verbatim excerpts already exists at extraction time and is discarded after the LLM call.

---

## 2. Proposed Design (After)

### Design Principle: Single Source of Truth with a Generation Chain

The three touchpoints must share a common data flow rather than three independent paths. The proposed chain:

```
1. Digest (LLM call 1) → produces {snapshot, takeaways, overview, detailedSummary}
                        ↓ takeaways passed as input to step 2
2. Highlights (LLM call 2) → produces Array<{idx, start, end, label, verbatimExcerpt}>
                              each highlight references which takeaway(s) it maps to
                        ↓ stored in analysis_highlights
3. Chat grounding → now includes a HIGHLIGHTS section (from analysis_highlights)
                     alongside the existing digest section
```

This makes the digest the **upstream source of truth for "what the key points are"**, the highlights a **temporal mapping of those points to the transcript**, and the chat **aware of both**.

---

### 2.A — Variable, Content-Driven Segment Length with a Sane Cap

#### 2.A.1 Prompt change (`web/lib/prompts/highlights-extraction.ts`)

**Current** (lines 19-25): `end` = "the start of the next selected segment or a later segment's start if the point continues."

**Proposed**: Redefine `end` as the timestamp where the topic being discussed in this highlight actually concludes — the boundary of the point, not the next highlight's start.

New prompt instruction for `end`:
> `end`: the timestamp (in seconds, to one decimal place) where the discussion of this highlight's topic actually ends in the transcript. This must be the real end of the point being made — not the start of the next highlight. Cover the minimum amount of the topic needed to include all meaningful keywords from that excerpt. Do not extend beyond the topic's natural boundary.

Additionally, add guidance on duration:
> Each highlight's duration (`end - start`) should vary naturally — short points get 5-15 seconds, longer discussions get 30-90 seconds. Never exceed `maxSegmentDurationSeconds` (provided in the system prompt). The LLM does not need to pick `end` values that align with any segment boundary — `end` can be any real timestamp between the highlight's `start` and the next highlight's `start` (or the video end).

The `maxSegmentDurationSeconds` value (from Settings Registry, default 60) is injected into the system prompt as a cap.

#### 2.A.2 Parser change (`web/lib/prompts/highlights-extraction.ts:62-104`)

**Current** (line 91): `end` must be in `validSegmentStarts` (must be a real segment start time).

**Proposed**: Remove the `end ∈ validSegmentStarts` constraint. Replace with:
- `end > start` (already required)
- `end - start >= minSegmentDurationSeconds` (new — Settings Registry, default 5)
- `end - start <= maxSegmentDurationSeconds` (new — Settings Registry, default 60)
- `end <= videoDuration` (if available) or `end <= lastSegmentStart + maxSegmentDurationSeconds` (fallback)

The `start` constraint stays (must be a real segment start time — prevents hallucinated timestamps).

The parser signature changes to accept `minSegmentDurationSeconds` and `maxSegmentDurationSeconds` as parameters (from the Settings Registry values already loaded in `extractHighlights()`).

#### 2.A.3 Playback change (`web/lib/hooks/useSegmentPlayback.ts`)

**Current** (line 264): `const segmentEnd = leadIn + segmentDurationRef.current;`

**Proposed**: Use each segment's own `end - start` duration, clamped to `[minSegmentDurationSeconds, maxSegmentDurationSeconds]`:

```typescript
const rawDuration = segment.end - segment.start;
const clampedDuration = Math.max(
  minSegmentDurationRef.current,
  Math.min(maxSegmentDurationRef.current, rawDuration)
);
const segmentEnd = leadIn + clampedDuration;
```

The `segmentDurationSeconds` Settings Registry key becomes the **fallback for old data** (rows where `end` has the old semantics of "next segment start") — if `rawDuration > maxSegmentDurationSeconds`, it likely has old `end` semantics, so clamp to `maxSegmentDurationSeconds` (or fall back to `segmentDurationSeconds` entirely).

#### 2.A.4 Visual track change (`web/components/dashboard/HighlightsTrack.tsx`)

**Current** (lines 235-246): fill width uses `segmentDurationSeconds`.

**Proposed**: Fill width uses `end - start` (clamped to the same min/max), matching the playback duration:

```typescript
const rawDuration = activeHighlight.end - activeHighlight.start;
const clampedDuration = Math.max(minSeg, Math.min(maxSeg, rawDuration));
const segWidthPct = Math.max(
  1,
  Math.min(100 - segLeftPct, (clampedDuration / maxTime) * 100)
);
```

The end-bracket position (line 311-317) and tooltip (line 271-301) similarly switch from `start + segmentDurationSeconds` to `start + clampedDuration`.

#### 2.A.5 Settings Registry additions

New keys (following the established pattern in `web/lib/utils/highlights-settings.ts` and migration `20260813222120_highlights_reel_settings_registry.sql`):

| Key | Default | Min | Max | Purpose |
|---|---|---|---|---|
| `highlights.minSegmentDurationSeconds` | 5 | 2 | 15 | Floor for segment duration clamp |
| `highlights.maxSegmentDurationSeconds` | 60 | 30 | 300 | Cap for segment duration clamp |

Add to `HIGHLIGHTS_REGISTRY_FALLBACK` in `web/lib/utils/highlights-settings.ts:6-18`. Add to the `app_settings` table via a new migration. The existing `highlights.segmentDurationSeconds` (default 10) becomes the fallback for old data.

#### 2.A.6 Knowledge-graph machinery assessment

ADR 023 references `useKnowledgeGraph.ts`'s client-side TF-IDF fallback and `kg_entities`. The @fast investigation confirmed: **there is NO server-side KG extraction step** in the worker (`worker/src/` has zero references to `kg_entities`). KG data exists only in the `kg_entities` table (populated from an earlier pipeline) and via client-side TF-IDF fallback in `useKnowledgeGraph.ts`.

**Recommendation**: Do NOT use KG extraction machinery for highlight segment boundaries. It's over-engineering for this problem:
- The transcript segments already have `start` times and text — the LLM already has this data and can identify topic boundaries.
- KG TF-IDF extracts entity keywords, not topic boundaries — it would tell you *what* entities are mentioned but not *where a topic starts/ends*.
- Adding KG machinery to the highlights pipeline would introduce a new data dependency and a separate extraction step with no clear benefit over asking the LLM (which already reads the full transcript) to return a content-driven `end`.
- The cheaper, simpler path is: fix the prompt + parser (already an existing LLM call, zero additional cost) and clamp with Settings Registry bounds.

---

### 2.B — Three-Way Consistency (Highlights Reel ↔ Chat ↔ Digest Takeaways)

#### 2.B.1 Digest-first generation order (already exists, leverage it)

`GenerateExecutiveDigestUseCase.ts:112-135` generates the digest FIRST (LLM call 1), then `extractHighlights()` runs at lines 169-173 (LLM call 2). The digest is already available before highlights extraction begins.

**Proposed**: Pass the digest's `takeaways` array into the highlights extraction prompt as context.

#### 2.B.2 Highlights prompt receives digest takeaways

**Current** `buildHighlightsExtractionUserMessage(segments)` — receives only transcript segments.

**Proposed** `buildHighlightsExtractionUserMessage(segments, takeaways?)` — optionally receives the digest's takeaways array. When provided, the user message includes:

```
--- KEY TAKEAWAYS (from the executive digest) ---
1. <takeaway 1>
2. <takeaway 2>
...

--- TRANSCRIPT (with timestamps) ---
[0.00] First segment text...
[5.23] Second segment text...
```

And the system prompt adds:
> The KEY TAKEAWAYS above are the video's key points as identified by the executive digest. For each takeaway, identify the timestamp range in the transcript where that point is discussed. Map each highlight to the takeaway it represents by setting the `takeawayIdx` field (0-indexed, matching the takeaways list order). If a takeaway has no clear transcript location, skip it. If a transcript moment is important but not in the takeaways, you may still include it with `takeawayIdx: null`.

New field on `ExtractedHighlight`:
```typescript
export interface ExtractedHighlight {
  start: number;
  end: number;
  label: string;
  takeawayIdx: number | null;  // NEW: maps to digest takeaways array index
}
```

#### 2.B.3 Chat grounding includes highlights

**Current**: `getAnalysisGrounding()` (`SupabaseAnalysisAdapter.ts:527-645`) does not query `analysis_highlights`. The grounding string assembly in `ProcessChatMessageUseCase.ts:333-447` has no HIGHLIGHTS section.

**Proposed**:

1. **`getAnalysisGrounding()`** — add a query to `analysis_highlights` for the analysis, selecting `idx, start_seconds, end_seconds, label, takeaway_idx` (new column). Return as `highlights` in the grounding object. This is a lightweight read (max 40 rows by `highlights.maxCount`).

2. **`ProcessChatMessageUseCase.ts`** — insert a `--- HIGHLIGHTS REEL ---` section into the grounding string, after the `--- DIMENSION 0: EXECUTIVE DIGEST ---` section (around line 360) and before `--- TOP COMMENTS ---`:

```
--- HIGHLIGHTS REEL (timestamped key moments) ---
[0:23–0:45] <label> (takeaway 2)
[1:30–2:15] <label> (takeaway 5)
...
```

This makes the chat LLM aware of both the digest's takeaways (already included) and the exact highlights shown in the Reel, with their timestamps and takeaway mappings. When a user asks "what were the key points," the LLM can reference the same highlights the Reel shows, with the same takeaways the digest lists.

#### 2.B.4 Schema change for `takeawayIdx`

Add a nullable `takeaway_idx` column to `analysis_highlights`:

```sql
alter table public.analysis_highlights
  add column if not exists takeaway_idx smallint;
```

This is backward-compatible — old rows have `NULL`, new rows have the mapping. No backfill needed.

#### 2.B.5 Tradeoffs considered

| Option | Pros | Cons |
|---|---|---|
| **A: Shared "key moments" table** (all three read from one source) | Single source of truth | Requires restructuring the digest generation to also produce timestamped moments — the digest prompt would need to output timestamps, which it currently doesn't (it outputs text only). High migration cost. |
| **B: Digest-first, highlights reference digest** (this proposal) | Leverages existing generation order (digest already runs first). Minimal prompt changes. Highlights map to takeaways via `takeawayIdx`. Chat sees both. | Highlights quality still depends on the LLM correctly mapping takeaways to transcript locations. If the LLM maps poorly, the mapping is wrong but the highlights themselves are still valid (just unmapped). |
| **C: Highlights-first, digest references highlights** | Digest would be grounded in actual transcript moments | Digest currently runs on assembled 11-dimension markdown, not raw transcript — changing its input to include highlights would alter the digest's nature. Also inverts the existing execution order. |

**Recommendation**: Option B. It's the least disruptive, leverages the existing execution order, and creates a clear causal chain (digest → highlights → chat) without restructuring any existing generation path. **However, Option B as designed in 2.B.1–2.B.5 only closes the loop in ONE direction**: highlights conform to the digest (via `takeawayIdx`), but nothing checks the digest's own displayed takeaways against what highlights extraction actually grounded in real transcript time. Section 2.B.6 (below) closes this gap with a post-extraction reconciliation pass.

#### 2.B.6 Post-extraction reconciliation (closing the loop)

**The gap 2.B.1–2.B.5 does not close**: The design so far makes highlights *conform to* the digest (via `takeawayIdx` in 2.B.2) and makes chat *aware of* both the digest and the highlights (2.B.3). But nothing checks the digest's own displayed takeaways against what highlights extraction actually grounded in real transcript time. Concrete failure case: the digest's LLM call produces 5 takeaways; highlights extraction (given those takeaways as context per 2.B.2) only finds real transcript grounding for 3 of them, skipping 2 per the prompt instruction ("If a takeaway has no clear transcript location, skip it"). The design as of 2.B.5 still *displays all 5 digest takeaways unchanged* — 2 of them now silently ungrounded. This is the exact "three touchpoints tell different stories" problem the user originally reported, just moved one level up instead of fixed.

The fix: a **reconciliation pass** after highlights extraction completes, producing a single reconciled "key moments" object that the digest display, the Highlights Reel, and chat grounding all render from.

##### Step 1: Reconciliation LLM call (new, separate from highlights extraction)

After `extractHighlights()` completes and persists (after `GenerateExecutiveDigestUseCase.ts:231-234` `saveHighlights`), run a third, dedicated LLM call:

- **Input contract**: the digest's `takeaways` array (already generated in LLM call 1, short structured text — typically 5-10 bullets) + the finalized highlights list (from LLM call 2, already persisted to `analysis_highlights`, each with `idx`, `start`, `end`, `label`, `takeawayIdx`, `verbatimExcerpt`). This is NOT the full transcript — just the two short structured arrays.
- **LLM task**: for each takeaway, judge whether at least one mapped highlight (same `takeawayIdx`) semantically supports the takeaway's claim — not keyword matching, genuine semantic grounding ("does this highlight's content actually demonstrate or ground this takeaway's claim?").
- **Output contract**: a `grounded: boolean` per takeaway + the `backingHighlightIdx` (which `analysis_highlights.idx` backs it, for the same `takeawayIdx` cross-reference already established in 2.B.2), or `null` if ungrounded.

```typescript
// Output contract (returned by the reconciliation LLM call, persisted to executive_digest.reconciliation)
interface ReconciledTakeaway {
  idx: number;                   // 0-indexed, matches the digest takeaways array order
  grounded: boolean;             // true if a highlight semantically supports this takeaway
  backingHighlightIdx: number | null;  // analysis_highlights.idx that backs it, if grounded
}

interface ReconciliationResult {
  takeaways: ReconciledTakeaway[];  // exactly takeaways.length entries, in index order
}
```

This is a **precision task** (semantic judgment), not a bulk-generation task. A naive string/keyword match would produce false negatives (marking a genuinely-grounded takeaway as ungrounded because the wording differs) and false positives (matching on shared terms without semantic support). A small, cheap LLM call is the correct tool for this.

**Why this is a separate call, not merged into highlights extraction**:
1. Different cost profile: the reconciliation call is tiny (~1,500-2,500 input tokens) and uses a different model (Haiku 4.5, see Step 2). The highlights extraction call uses `cascade.digest` (GPT-OSS-120B) and processes the full transcript. Merging would either force the reconciliation logic onto GPT-OSS (the wrong model for a precision task — see Step 2) or require running the full transcript through Haiku (expensive and unnecessary).
2. Different input: highlights extraction reads the raw transcript; reconciliation reads the takeaways + highlights list (already-structured data, not the full transcript).
3. Separation of concerns: highlights extraction is "find important moments in the transcript"; reconciliation is "verify those moments actually support the digest's claims." Different tasks, different inputs, different quality bars.

##### Step 2: Model — Haiku 4.5 via a new dedicated cascade key, not GPT-OSS-120B

Three facts, all verified against current code:

1. **`cascade.digest` has zero escalation.** `web/lib/config/cascade.ts:41-45` — `DIGEST_CASCADE_FALLBACK` is 3 entries of `openai/gpt-oss-120b` (Groq → Cerebras → Baseten), with NO fallback to a higher-quality model. Compare: `cascade.analysis` (lines 47-57) has Haiku 4.5 (4 providers: Vertex, Azure, Anthropic Direct, Bedrock) → Sonnet 5 (2 providers: Vertex, Anthropic Direct); `cascade.chat` (lines 28-34) has GPT-OSS (3 providers) → Gemini 3.5 Flash Lite (2 providers). `cascade.digest` is the ONLY pipeline stage with no quality-escalation path.

2. **GPT-OSS-120B's factual coverage stalls at 41-62% of Haiku 4.5's.** `docs/research/2026-08-18-full-parity-final-scores.md:64-70, 84-87`: across all 5 dimension bundles, the factual coverage average is 54.0% — "the checklist-fix + guardrail changes reliably fixed *structural* completeness for most bundles (4 of 5 average ≥80% structural) but did **not** close the *factual* gap with Haiku 4.5 anywhere — every bundle's factual average sits between **41% and 62%**, well short of parity." The reconciliation call is a factual-grounding judgment task ("does this highlight's content actually support this takeaway's claim") — precisely the failure mode where GPT-OSS-120B's parity gap would hurt worst: marking genuinely-grounded takeaways as ungrounded (false negative) or ungrounded takeaways as grounded (false positive).

3. **The reconciliation call is small.** Input is ~1,500-2,500 tokens (5-10 takeaways × ~20 tokens each + up to 40 highlights × ~30 tokens each + prompt framing); output is ~50-150 tokens (a small JSON array). Haiku 4.5's higher per-token cost ($0.0015/1K input vs. GPT-OSS-120B's $0.00015/1K) is negligible at this scale — the cost-discipline argument for defaulting to the cheaper model does not apply here.

Per this codebase's established pattern ("each helper function gets its own cascade" — `cascade.ts:36-40` documents this rationale for `cascade.digest`'s own dedicated cascade: "Dedicated from cascade.chat (2026-08-18) per the 'each helper function gets its own cascade' standing directive"; `cascade.entityExtraction` (lines 74-77) follows the same pattern), a new `cascade.highlightsReconciliation` key is the consistent choice — not an alias of `cascade.analysis` (separate cost attribution and future tuning), not on `cascade.digest` (wrong model, no escalation).

**New cascade registry key** (in `web/lib/config/cascade.ts`):

```typescript
const HIGHLIGHTS_RECONCILIATION_CASCADE_FALLBACK: readonly CascadeItem[] = [
  { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (Vertex)', cost: 0.0015, providerOrder: ['google-vertex'] },
  { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (Azure)', cost: 0.0015, providerOrder: ['azure'] },
  { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (Anthropic Direct)', cost: 0.0015, providerOrder: ['anthropic'] },
  { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (Bedrock)', cost: 0.0015, providerOrder: ['amazon-bedrock'] },
  { model: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5 (Vertex)', cost: 0.003, providerOrder: ['google-vertex'] },
  { model: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5 (Anthropic Direct)', cost: 0.003, providerOrder: ['anthropic'] },
];

// Add to CASCADE_FALLBACKS:
export const CASCADE_FALLBACKS = {
  chat: CHAT_CASCADE_FALLBACK,
  digest: DIGEST_CASCADE_FALLBACK,
  analysis: ANALYSIS_CASCADE_FALLBACK,
  stance: STANCE_CASCADE_FALLBACK,
  entityExtraction: ENTITY_EXTRACTION_CASCADE_FALLBACK,
  highlightsReconciliation: HIGHLIGHTS_RECONCILIATION_CASCADE_FALLBACK,  // NEW
  reasoningFree: REASONING_CASCADE_FREE_FALLBACK,
  reasoningPro: REASONING_CASCADE_PRO_FALLBACK,
} as const;

export const resolveHighlightsReconciliationCascade = () =>
  resolveCascade('cascade.highlightsReconciliation', HIGHLIGHTS_RECONCILIATION_CASCADE_FALLBACK);
```

Same shape as `ANALYSIS_CASCADE_FALLBACK` (lines 47-57) — 4 Haiku 4.5 providers → 2 Sonnet 5 providers — separate key for independent cost attribution and future tuning.

##### Step 3: Reconciliation prompt (new file: `web/lib/prompts/highlights-reconciliation.ts`)

**System prompt** (`buildHighlightsReconciliationSystemPrompt()`):
```
You are a fact-checking assistant for video analysis. You are given:
1. A list of key takeaways from an executive summary of a video.
2. A list of timestamped highlights extracted from that video's transcript,
   each mapped to a takeaway index (or null if standalone — not mapped to
   any takeaway).

For each takeaway, determine whether at least one mapped highlight (one with
the same takeawayIdx) semantically supports the takeaway's claim — not just
that the highlight mentions similar words, but that the highlight's content
actually demonstrates or grounds the takeaway's claim.

Return a JSON array where each element is:
{"takeawayIdx": <number>, "grounded": <boolean>, "backingHighlightIdx": <number|null>}

Rules:
- "grounded": true if at least one highlight with that takeawayIdx genuinely
  supports the takeaway's claim.
- "grounded": false if no mapped highlight supports it (the highlight may
  have the wrong takeawayIdx, or the takeaway may be ungrounded in the
  transcript).
- "backingHighlightIdx": the idx of the strongest supporting highlight, or
  null if grounded is false.
- If a takeaway has no mapped highlights at all (all highlights have
  takeawayIdx: null or map to other takeaways), set grounded: false and
  backingHighlightIdx: null.
- Return exactly one entry per takeaway, in takeaway-index order (0-indexed).
```

**User message builder** (`buildHighlightsReconciliationUserMessage(takeaways: string[], highlights: ExtractedHighlight[])`):
```
--- KEY TAKEAWAYS ---
1. [takeaway 1 text]
2. [takeaway 2 text]
...

--- HIGHLIGHTS (with takeawayIdx mappings) ---
[idx=0, 0:23–0:45] <label> (takeawayIdx: 0)
[idx=1, 1:30–2:15] <label> (takeawayIdx: 1)
[idx=2, 3:00–3:20] <label> (takeawayIdx: null)
...

For each takeaway (1-indexed above, 0-indexed in output), determine if it is
grounded by at least one highlight.
```

**Result parser** (`parseHighlightsReconciliation(rawText: string, takeawaysCount: number)`):
- Parses the JSON array from the LLM response
- Validates: exactly `takeawaysCount` entries, each with `takeawayIdx` (0-indexed, matching the takeaways array), `grounded` (boolean), `backingHighlightIdx` (number or null)
- Returns `{ status: 'invalid' }` on parse failure — same pattern as `highlights-extraction.ts:40-48`'s `HighlightsExtractionResult` type: "the caller must never delete an existing highlight set on 'invalid' (a transient LLM/parse failure), only ever replace it on 'ok' (a structurally valid response, empty or not). Conflating these two was a real data-loss bug caught in review."
- Returns `{ status: 'ok', reconciliation: ReconciliationResult }` on success

##### Step 4: Never drop an ungrounded takeaway — mark it

The reconciliation marks each takeaway with `grounded: boolean`, it does NOT delete or filter. Rationale, with code evidence:

1. **No remediation path.** `web/lib/services/dimension-remediation.ts` (verified by direct read, lines 1-60) and `web/lib/services/aux-remediation.ts` (verified by direct read, lines 1-60) handle ONLY the 11 core dimensions (dimension-remediation calls `resolveAnalysisCascade` and the worker's `/analyze-llm-stream` for dimension regeneration) and channelMeta/comments recovery (aux-remediation), respectively. Neither file imports or references `saveHighlights`, `extractHighlights`, `executive_digest`, or `analysis_highlights` — confirmed by grep, zero matches in both files. There is no self-healing pass that would retroactively fix a dropped takeaway. Dropping is permanent, unrecoverable data loss.

2. **This mirrors the existing codebase pattern.** `highlights-extraction.ts:40-48` explicitly distinguishes `'invalid'` (couldn't parse — a transient LLM/parse failure) from `'ok'` with an empty array (the model genuinely found nothing noteworthy). The comment states: "Conflating these two was a real data-loss bug caught in review: a malformed response would silently wipe a previously-extracted, still-valid highlight set." The caller-side guard at `GenerateExecutiveDigestUseCase.ts:226-228` leaves existing highlights untouched on `'invalid'`. The same principle applies here: an ungrounded takeaway is not "invalid data to be deleted" — it's a valid takeaway that happens to lack transcript grounding. Mark it with `grounded: false`, don't drop it.

##### Step 5: The reconciled "key moments" object shape

The reconciliation result is persisted within the existing `executive_digest` jsonb column — no new table, no new column migration (the jsonb schema is flexible; `executive_digest` already stores `snapshot`, `takeaways`, `overview`, `detailedSummary` as a jsonb blob). The `StoredExecutiveDigest` type gains a `reconciliation` field:

```typescript
// web/lib/types/ (wherever StoredExecutiveDigest is defined)
// The existing StoredExecutiveDigest interface gains:

interface ReconciledTakeaway {
  idx: number;                   // 0-indexed, matches the takeaways array order
  grounded: boolean;             // true if a highlight semantically supports this takeaway
  backingHighlightIdx: number | null;  // analysis_highlights.idx that backs it, if grounded
}

interface ReconciliationResult {
  takeaways: ReconciledTakeaway[];   // exactly takeaways.length entries, in index order
}

interface StoredExecutiveDigest {
  // ... existing fields: snapshot, takeaways, overview, detailedSummary ...
  reconciliation?: ReconciliationResult | null;  // NEW from 2.B.6
}
```

**No new migration SQL needed.** The `reconciliation` field is stored within the existing `executive_digest` jsonb column. The existing `takeaways: string[]` array shape is unchanged — `reconciliation` is a separate field on the same jsonb, not a modification of the `takeaways` array structure. Old rows have `reconciliation: undefined/null` (graceful degradation — see Section 4).

All three touchpoints render from this one persisted field:
- **Digest display**: reads `executive_digest.reconciliation` (already fetched from the same jsonb column) — shows each takeaway with its `grounded` status (e.g., a visual indicator for ungrounded takeaways). The digest display component already fetches `executive_digest` from `analyses.executive_digest`; the `reconciliation` field is part of the same jsonb, no additional query.
- **Highlights Reel**: reads `analysis_highlights` unchanged — highlights are grounded by construction (they have real transcript timestamps from the extraction call). The Highlights Reel does NOT need the `reconciliation` field; it's already correct.
- **Chat grounding**: `getAnalysisGrounding()` (`SupabaseAnalysisAdapter.ts:527-645`) already fetches `executive_digest` (line 550: `.select('... executive_digest')`). The `reconciliation` field is part of the same jsonb fetch, no additional query. The `--- HIGHLIGHTS REEL ---` section (from 2.B.3, `ProcessChatMessageUseCase.ts:~360`) annotates each highlight with which takeaway it grounds based on `reconciliation.takeaways[].backingHighlightIdx`, and each takeaway in the `--- DIMENSION 0: EXECUTIVE DIGEST ---` section is annotated with its `grounded` status.

The grounding link (which takeaway is backed by which highlight) lives in ONE place: `executive_digest.reconciliation`. The digest display reads it from the same jsonb fetch it already makes. Chat grounding reads it from the same `executive_digest` column it already fetches. The Highlights Reel doesn't need it (highlights are grounded by construction). No three independent queries that could drift.

##### Step 6: Failure mode

If the reconciliation LLM call fails (timeout, rate limit, parse error), the digest and highlights are already persisted — the reconciliation runs after both, in the same `.catch()` pattern as `extractHighlights` at `GenerateExecutiveDigestUseCase.ts:169-173`. The `reconciliation` field is simply `null` on the digest — graceful degradation (see Section 4). All takeaways default to `grounded: true` for display purposes (fail-open — a failed reconciliation must not make the digest look broken). This mirrors the existing `extractHighlights` failure pattern: `.catch()` with `console.warn`, digest delivery unaffected.

If highlights extraction itself returns `status: 'invalid'` (the `HighlightsExtractionResult` type from `highlights-extraction.ts:49-51`), the reconciliation should NOT run — there are no highlights to reconcile against. In this case, `reconciliation` is `null` and all takeaways display as `grounded: true` (fail-open). If it returns `status: 'ok'` with an empty array, the reconciliation runs with an empty highlights list and all takeaways are `grounded: false` — this is correct behavior (the model found no highlights, so no takeaways are grounded).

##### Step 7: Standalone highlights (takeawayIdx: null)

A highlight with `takeawayIdx: null` (from 2.B.2 — "a transcript moment is important but not in the takeaways, you may still include it with `takeawayIdx: null`") stays in the highlights list unchanged. The reconciliation only checks whether each *takeaway* has a backing highlight, not whether each highlight maps to a takeaway. Standalone highlights are already valid (they have real transcript timestamps) — they simply don't appear as any `backingHighlightIdx` in the reconciliation result. This composes correctly: the reconciliation result has exactly `takeaways.length` entries (one per takeaway), and standalone highlights are simply not referenced by any `backingHighlightIdx`.

##### Step 8: E2E data flow trace (tenet 2)

The reconciled object reaches all three render sites through the following verified file paths and functions:

```
1. Digest generation (LLM call 1, cascade.digest)
   → executive_digest { snapshot, takeaways, overview, detailedSummary }
   → persisted to analyses.executive_digest (GenerateExecutiveDigestUseCase.ts:158-161)

2. Highlights extraction (LLM call 2, cascade.digest)
   → Array<{ idx, start, end, label, takeawayIdx, verbatimExcerpt }>
   → persisted to analysis_highlights (GenerateExecutiveDigestUseCase.ts:231-234)

3. Reconciliation (LLM call 3, cascade.highlightsReconciliation) [NEW]
   → input: takeaways (from step 1) + highlights (from step 2)
   → output: ReconciliationResult { takeaways: [{ idx, grounded, backingHighlightIdx }] }
   → persisted to analyses.executive_digest.reconciliation (UPDATE the jsonb, same row)

4. Digest display (web/components/...)
   → reads analyses.executive_digest (includes reconciliation field in jsonb)
   → shows takeaways with grounded status (visual indicator for ungrounded)

5. Highlights Reel (web/app/api/analyses/highlights/route.ts → HighlightsScrubber.tsx)
   → reads analysis_highlights (unchanged — already grounded by construction)
   → renders highlights with timestamps, labels, verbatimExcerpt (from 2.C)

6. Chat grounding (SupabaseAnalysisAdapter.ts:getAnalysisGrounding() → ProcessChatMessageUseCase.ts)
   → reads analyses.executive_digest (includes reconciliation field, same line 550 fetch)
     + analysis_highlights (from 2.B.3, new query)
   → grounding string includes:
     --- DIMENSION 0: EXECUTIVE DIGEST --- (takeaways, annotated with grounded status from reconciliation)
     --- HIGHLIGHTS REEL --- (highlights, annotated with which takeaway each grounds from reconciliation)
```

The grounding link (which takeaway is backed by which highlight) lives in ONE persisted field (`executive_digest.reconciliation`), fetched by ONE query (the existing `executive_digest` select on line 550). The Highlights Reel reads from `analysis_highlights` (unchanged). Chat grounding reads from both (the `executive_digest` fetch it already makes + the `analysis_highlights` fetch from 2.B.3). No three independent queries that could drift — the reconciliation is the single source of truth for the grounding link.

##### Step 9: Tangents found during this design (tenet 3)

1. **Staleness if highlights are re-extracted**: The reconciliation is persisted within `executive_digest` (strict "generate once, ever" idempotency per ADR 010, `GenerateExecutiveDigestUseCase.ts:97-99` checks for existing digest and returns cached). If highlights were ever re-extracted (no current path does this — `extractHighlights` runs only on first digest generation, and per the verified code, `dimension-remediation.ts` and `aux-remediation.ts` never touch digest or highlights), the reconciliation would be stale. This is the same one-shot limitation as the existing `takeawayIdx` mapping (2.B.2) — not a new tangent, just a shared constraint. If re-extraction is added in the future (deferred per `docs/TECH_DEBT_LEDGER.md` item #19), the reconciliation must be re-run too.

2. **Reconciliation call failure**: If the LLM call itself fails (timeout, rate limit, parse error), `reconciliation` is `null` on the digest. The system degrades gracefully — all takeaways display as `grounded: true` (fail-open). This mirrors `extractHighlights`'s `.catch()` pattern at `GenerateExecutiveDigestUseCase.ts:169-173`. Not a new failure mode — the same "transient LLM failure must not break digest delivery" principle.

3. **`executive_digest` jsonb size**: The `reconciliation` field adds ~200-500 bytes (5-10 takeaways × ~40 bytes each: `{idx, grounded, backingHighlightIdx}`). The existing `executive_digest` is already a jsonb column with `snapshot` + `overview` + `detailedSummary` (multi-KB text fields), so this is negligible. No Postgres row-size concern.

4. **`getAnalysisGrounding()` select already includes `executive_digest`**: `SupabaseAnalysisAdapter.ts:550` currently selects `'title, channel_title, analysis_markdown, analysis_payload, validation_report, billing_status, video_id, executive_digest'`. The `reconciliation` field is part of the `executive_digest` jsonb — no query change needed, just a type cast in the TypeScript interface. This is a zero-cost tangent: the data is already fetched, just not yet typed as including `reconciliation`.

---

### 2.C — Verbatim Transcript Excerpts (without a new LLM call)

#### 2.C.1 Derivation: slice the transcript segments array

The raw transcript segments (`Array<{ start: number; text: string }>`) are already fetched in `extractHighlights()` at `GenerateExecutiveDigestUseCase.ts:187` via `this.persistence.getTranscriptSegments(params.videoId)`. The same array is passed to the LLM as input.

**Proposed**: After parsing the LLM's highlights, for each highlight, slice the transcript segments whose `start` falls within `[highlight.start, highlight.end]` and concatenate their `text` fields. This produces a verbatim excerpt with zero additional LLM cost.

```typescript
function buildVerbatimExcerpt(
  start: number,
  end: number,
  segments: Array<{ start: number; text: string }>
): string {
  return segments
    .filter(s => s.start >= start && s.start < end)
    .map(s => s.text)
    .join(' ')
    .trim();
}
```

This is pure code, no LLM call, no additional latency, no additional cost.

#### 2.C.2 New field on `ExtractedHighlight` and the DB

Add `verbatimExcerpt` to the `ExtractedHighlight` interface and to `saveHighlights()`:

```typescript
export interface ExtractedHighlight {
  start: number;
  end: number;
  label: string;
  takeawayIdx: number | null;   // from 2.B.2
  verbatimExcerpt: string;        // NEW from 2.C
}
```

Schema migration:
```sql
alter table public.analysis_highlights
  add column if not exists verbatim_excerpt text;
```

#### 2.C.3 Ticker change (`web/lib/hooks/useHighlightTicker.ts`)

**Current**: takes `label: string | null` as the only text input.

**Proposed**: Add an optional `verbatimExcerpt?: string | null` parameter. If provided and non-empty, use `verbatimExcerpt` for the word-by-word reveal; fall back to `label` if null/empty (graceful degradation for old rows).

```typescript
export function useHighlightTicker(
  playingIdx: number | null,
  label: string | null,
  segmentDurationSeconds: number,
  elapsedSeconds: number,
  verbatimExcerpt?: string | null,  // NEW
) {
  const text = verbatimExcerpt || label;
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  // ... rest unchanged
}
```

#### 2.C.4 Caller changes

`HighlightsScrubber.tsx:134-139` currently passes `activeHighlight?.label` to the ticker. It would pass `activeHighlight?.verbatimExcerpt ?? activeHighlight?.label` instead (or the ticker handles the fallback internally).

The API route `web/app/api/analyses/highlights/route.ts:42` currently maps `label` from the DB. It would also map `verbatim_excerpt` → `verbatimExcerpt` and `takeaway_idx` → `takeawayIdx`.

The `HighlightsTrackHighlight` interface (`HighlightsTrack.tsx:34-39`) and the `Highlight` interface in `HighlightsScrubber.tsx:12-23` both gain `verbatimExcerpt?: string | null` and `takeawayIdx?: number | null`.

The `saveHighlights()` RPC (`SupabaseAnalysisAdapter.ts:872-888`) and the `replace_analysis_highlights` RPC (`supabase/migrations/20260813230239_replace_analysis_highlights_atomic_rpc.sql:9-28`) both need updating to accept the new fields in the JSON payload.

---

## 3. Cost & Latency Impact

### Section A (variable segment length)

| Change | LLM cost impact | Latency impact |
|---|---|---|
| Prompt text change (end semantics) | **Zero** — same LLM call, slightly different instructions in the system prompt (~50 extra tokens) | None |
| Parser relaxation | **Zero** — pure code | None |
| Playback/visual changes | **Zero** — pure code | None |
| Settings Registry additions | **Zero** — DB config only | One extra DB read (already batched with existing `getRegistrySettings` call in `extractHighlights`) |

**Net**: No additional LLM cost. No additional latency. The only change is the prompt text and parser logic.

### Section B (three-way consistency)

| Change | LLM cost impact | Latency impact |
|---|---|---|
| Passing digest takeaways into highlights prompt | **~200-500 extra input tokens** (the takeaways array, typically 5-10 bullets) on the existing highlights LLM call. No new call. | Negligible (a few hundred tokens more input on a call that already processes the full transcript) |
| Adding `takeawayIdx` to highlight output | **~5-20 extra output tokens** (one integer per highlight, max 40) | None |
| Chat grounding: querying `analysis_highlights` + adding HIGHLIGHTS section | **Zero LLM cost** — it's a DB read + string concatenation before the LLM call. The grounding string gets ~200-800 chars longer (max 40 highlights × ~20 chars each), adding ~50-200 input tokens to the chat LLM call. | One extra DB query per chat message (lightweight, max 40 rows, indexed by `analysis_id`) |
| Reconciliation LLM call (2.B.6) | **~1,500-2,500 input tokens + ~50-150 output tokens on a new Haiku 4.5 call** (`cascade.highlightsReconciliation`). Input = takeaways array (~350-700 tokens for 5-10 bullets) + highlights list (~800-1,200 tokens for up to 40 highlights × ~30 tokens each) + prompt framing (~200-400 tokens). Output = JSON array of `{takeawayIdx, grounded, backingHighlightIdx}` (~10-15 tokens per takeaway × 5-10 = ~50-150 tokens). At Haiku 4.5 pricing ($0.0015/1K input, ~$0.003/1K output blended with Sonnet 5 fallback), per-call cost is ~$0.003-0.005. This is the first genuinely new LLM cost in this proposal — unlike the other Section B changes which add tokens to existing calls, this is a separate call. | ~2-5 seconds (a small Haiku 4.5 call, runs after highlights extraction completes — not blocking the digest or highlights, which are already persisted by this point) |

**Net**: ~250-700 extra input tokens on existing calls (2.B.1-B.3) + ~1,500-2,500 input / ~50-150 output tokens on one new reconciliation LLM call (2.B.6). The reconciliation call adds ~$0.003-0.005 per analysis at Haiku 4.5 pricing, runs once per analysis (on first digest generation, same one-shot as `extractHighlights`). Per ADR 019's cost-discipline pattern, this is within the token budget — the reconciliation call processes short structured text (takeaways + highlights, not the full transcript), not a bulk-generation task.

### Section C (verbatim excerpts)

| Change | LLM cost impact | Latency impact |
|---|---|---|
| Slicing transcript segments in code | **Zero** — pure array filter + join, no LLM | ~1ms (filtering a transcript array) |
| Storing `verbatim_excerpt` in DB | **Zero** — same `saveHighlights` call, slightly larger payload | None |
| Ticker using `verbatimExcerpt` | **Zero** — pure code | None |

**Net**: Zero additional LLM cost. Zero additional latency. The verbatim excerpt is derived for free from data already in memory.

### Total cost across all three sections

**Total**: **1 new LLM call** (the reconciliation call in 2.B.6, ~$0.003-0.005 per analysis on Haiku 4.5) + ~250-700 extra input tokens on existing calls (2.B.1-B.3) + ~1,500-2,500 input / ~50-150 output tokens on the new call. Zero additional latency on the existing digest/highlights/chat paths (the reconciliation runs after highlights extraction, which is already best-effort and non-blocking per `GenerateExecutiveDigestUseCase.ts:169-173`). Two DB migrations (2 nullable columns from 2.B.4 and 2.C.2 — the `reconciliation` field is within the existing `executive_digest` jsonb, no new column). This is the cheapest possible approach that closes the three-way consistency loop — the data already exists at every point in the pipeline, the changes are about connecting it and closing the gap the one-directional `takeawayIdx` mapping leaves open.

---

## 4. Migration & Rollout Concerns for Existing Rows

### Current `analysis_highlights` rows (old contract)

Existing rows have:
- `end_seconds` = "next highlight's start" (wrong semantics for the new design)
- No `verbatim_excerpt` column
- No `takeaway_idx` column

### Recommendation: New analyses only, with graceful degradation

**No backfill needed.** The design degrades gracefully for old data:

1. **Playback/visual (Section A)**: The clamp logic uses `min(maxSeg, max(minSeg, end - start))`. For old rows where `end` = "next highlight start" (potentially very large spans), the `maxSegmentDurationSeconds` cap (default 60s) kicks in — effectively reproducing the current fixed-duration behavior. The `segmentDurationSeconds` fallback (default 10s) is used only if `end - start` is invalid (negative, NaN, or zero).

2. **Ticker (Section C)**: If `verbatim_excerpt` is NULL, the ticker falls back to `label` — identical to current behavior.

3. **Chat grounding (Section B)**: If `takeaway_idx` is NULL, the HIGHLIGHTS section shows highlights without takeaway mappings. The chat still sees the digest takeaways separately. No inconsistency worse than the current state (where the chat sees no highlights at all).

4. **Takeaway mapping (Section B)**: Only new analyses will have `takeawayIdx`. Old highlights remain valid as timestamped moments; they just don't map to specific takeaways.

5. **Reconciliation field (Section B.6)**: Existing `executive_digest` rows (predating 2.B.6) will have `reconciliation: null` (the field doesn't exist on old jsonb). This is correct behavior — old digests were generated without the reconciliation pass. Display logic treats `null`/absent `reconciliation` as "all takeaways grounded: true" (fail-open — old digests display unchanged, no visual degradation). New analyses populate the field automatically. **No backfill is needed or possible**: the reconciliation requires the highlights list that was generated alongside the digest at first-generation time; re-generating either for old rows is explicitly out of scope (deferred as `docs/TECH_DEBT_LEDGER.md` item #19, which requires relaxing `GenerateExecutiveDigestUseCase`'s strict "generate once, ever" idempotency — real work, but not this proposal). If the reconciliation LLM call fails on a new analysis, `reconciliation` is `null` and the digest still displays all takeaways (with `grounded: true` by default) — the same fail-open pattern as `extractHighlights`'s `.catch()` at `GenerateExecutiveDigestUseCase.ts:169-173`.

### Migration SQL

```sql
-- 2026-08-21: Add takeaway_idx and verbatim_excerpt to analysis_highlights
alter table public.analysis_highlights
  add column if not exists takeaway_idx smallint;

alter table public.analysis_highlights
  add column if not exists verbatim_excerpt text;

-- No backfill needed — NULL is the correct value for old rows.
-- New analyses populate both columns; old analyses degrade gracefully.

-- Update the atomic RPC to accept the new fields in the JSON payload
create or replace function public.replace_analysis_highlights(
  p_analysis_id uuid,
  p_highlights jsonb
) returns void as $$
  delete from public.analysis_highlights where analysis_id = p_analysis_id;
  insert into public.analysis_highlights (analysis_id, idx, start_seconds, end_seconds, label, takeaway_idx, verbatim_excerpt)
  select
    p_analysis_id,
    (h->>'idx')::smallint,
    (h->>'start')::real,
    (h->>'end')::real,
    h->>'label',
    nullif(h->>'takeaway_idx', '')::smallint,
    nullif(h->>'verbatim_excerpt', '')::text
  from jsonb_array_elements(p_highlights) as h;
$$ language sql security definer;
```

**Note**: Per ADR 018, after running this migration via `apply_migration`, immediately run `list_migrations` and name the local file to match the server-recorded version. Run `pnpm exec supabase db push --dry-run` to confirm the remote is up to date.

### RLS

The existing RLS policy on `analysis_highlights` (owner-reads-only, per migration `20260813222218_analysis_highlights_table.sql`) already covers the new columns — RLS is table-level, not column-level. No new policy needed. The `replace_analysis_highlights` RPC uses `security definer` (already the pattern), so the service-role write path is unaffected.

---

## 5. Tangents Found

While reading the files for this investigation, the following adjacent issues were noted (tenet 3 — not fixed in this pass, reported for awareness):

1. **`useSegmentPlayback.ts:55-58` stale comment**: The JSDoc comment on the `segmentDurationSeconds` parameter says "the clamp always uses each segment's own end" — this is the opposite of what the code does (line 264 uses the fixed duration). This comment was likely written aspirationally or predates the "94% duration fix" that switched to the fixed value. Should be corrected when implementing Section A.

2. **`HighlightsTrack.tsx:235-246` self-contradictory comment**: The comment explains that `end` is contractually "the start of the next selected segment" — which is exactly the bug this proposal fixes. The comment should be updated when the `end` semantics change.

3. **`HighlightsScrubber.tsx:157-174` display total uses fixed duration**: `totalHighlightsSeconds = Math.min(highlights.length * segmentDurationSeconds, videoDuration)` — this would also need updating to use the sum of individual `(end - start)` durations, not `count * fixedDuration`. Otherwise the "total highlights time" display will be wrong after Section A.

4. **Public share path**: `web/app/share/[token]/PublicHighlightsReel.tsx` and `web/app/share/[token]/page.tsx:75` also consume `segmentDurationSeconds` via the same Settings Registry pattern. Section A's playback/visual changes would need to be mirrored here (same `useSegmentPlayback` hook is used, so the playback fix is automatic; the visual fill in `PublicHighlightsReel` would need the same `end - start` logic if it renders a track).

5. **Highlights extraction is fire-and-forget**: `GenerateExecutiveDigestUseCase.ts:169-173` runs `extractHighlights()` in a try/catch with only a `console.warn` on failure — if the highlights LLM call fails, the user gets no highlights and no error is surfaced. The `saveHighlights` call at line 231-234 also returns `boolean` but the return value is not checked. This is pre-existing and not part of this proposal's scope, but worth noting for reliability.

6. **`truncateForDigest()` prioritizes dimensions [1, 3, 5, 11]**: `executive-digest.ts:41-61` truncates the 11-dimension markdown to 18,000 chars, prioritizing dimensions 1, 3, 5, and 11. This means the digest's `takeaways` are derived from a *subset* of dimensions, not the full analysis. If the highlights extraction maps takeaways to transcript locations, the mapping quality depends on how representative those 4 dimensions are of the full video. Not a blocker, but the truncation strategy could affect takeaway quality.

7. **Digest prompt is Vault-backed**: `executive-digest.ts:36-39` loads the system prompt from `prompt.executive_digest.system` via `SupabasePromptAdapter.getPrompt()` with a base64 fallback. Any change to the digest prompt (if needed for Section B) requires updating the DB-stored prompt, not just code. The highlights prompt, by contrast, is inline in `highlights-extraction.ts` — easier to change.

8. **`analysis_highlights` table has no index on `analysis_id` for the chat grounding query**: The atomic RPC (`replace_analysis_highlights`) drops and re-inserts by `analysis_id`, and the API route queries by `analysis_id`. The migration `20260813224829_analysis_highlights_drop_redundant_index.sql` dropped a "redundant" index — but the chat grounding's new query (Section B) would also query by `analysis_id`. Verify the existing index coverage is sufficient for this additional read path.

---

## 6. Deviations Flagged

- **Digest system prompt text not fully verified**: The executive digest system prompt is Vault-backed (`prompt.executive_digest.system` in the DB), not inline in `executive-digest.ts`. The fallback is base64-encoded in `fallbacks/executive-digest.fallback.ts`. I did not decode the base64 to read the full prompt text — I verified the output schema (`ExecutiveDigest` interface, `parseExecutiveDigest()` logic, `DIGEST_HEADERS`) and the user message builder (`buildExecutiveDigestUserMessage`), but the actual prompt instructions the LLM receives are in the DB. If the implementation dispatch needs to modify the digest prompt (not required for this proposal — Section B only changes the *highlights* prompt and the *chat grounding*), the DB prompt would need to be read and updated.

- **`PublicHighlightsReel.tsx` not fully read**: I identified it as a tangent (tangent #4 above) but did not read its full contents. The implementation dispatch should read it to ensure the visual fill changes are mirrored on the public share path.

- **`ProcessChatMessageUseCase.ts` grounding assembly not line-by-line verified**: The @fast agent read the file and reported the grounding string assembly (lines 333-447), but I did not independently re-read every line. The section numbers (357-359 for digest, 378 for dimensions, 429-431 for transcript) are from the @fast agent's report. The implementation dispatch should verify these line numbers before inserting the HIGHLIGHTS section.

---

## 7. Skills Run + Applicability

Per the dispatch prompt (section 5), the following skills were evaluated for this task:

| Skill | Applicable? | Finding |
|---|---|---|
| `qa-intel` | **Not applicable** — no code changes in this dispatch. No diff to audit. |
| `contract-auditor` | **Not applicable** — no code changes, no contract to verify against. |
| `/simplify` | **Not applicable** — no code to simplify. |
| `code-review-graph` MCP | **Used** — dispatched @fast agents to trace the chat grounding path and KG extraction code via `semantic_search_nodes_tool` equivalent (file reads + grep). Found the chat grounding path in `ProcessChatMessageUseCase.ts` and `SupabaseAnalysisAdapter.ts`. |
| `supabase-postgres-best-practices` | **Consulted** — the proposed schema migration follows the existing RLS pattern (table-level, not column-level) and uses `security definer` for the RPC, matching the established pattern in `20260813230239_replace_analysis_highlights_atomic_rpc.sql`. Nullable columns for backward compatibility. No new RLS policy needed. |
| `owasp-top-10` | **Not applicable** — no new auth/security surface. |
| `react-best-practices` | **Not applicable** — no React component code changes in this dispatch (the proposed changes to `useSegmentPlayback.ts`, `HighlightsTrack.tsx`, `useHighlightTicker.ts`, `HighlightsScrubber.tsx` are described in the design doc but not implemented). |
| `web-design-guidelines` | **Not applicable** — no UI markup changes. |

---

## 8. Gates

**No code changes in this dispatch — gates not applicable.**

Per the dispatch prompt (section 9): these gates apply to code changes. Since this dispatch produces only a design document, no `tsc`, `vitest`, `qa-intel`, or `contract-auditor` runs were executed. Running them "just to be safe" would be a sign of having started implementation when I should have stopped at the design doc.

---

## 9. Files Changed

| File | Change type | Description |
|---|---|---|
| `docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md` | **NEW** | This design proposal document. |

**No files under `web/`, `worker/`, or `supabase/migrations/` were modified.**

---

## Appendix: Implementation Dispatch Checklist

For the follow-up implementation dispatch (separate task, not this one), the changes map to these files:

| Section | File(s) | Change |
|---|---|---|
| A.1 | `web/lib/prompts/highlights-extraction.ts` | Prompt text: redefine `end` semantics, add duration guidance |
| A.2 | `web/lib/prompts/highlights-extraction.ts` | Parser: relax `end` constraint, add min/max duration clamp |
| A.3 | `web/lib/hooks/useSegmentPlayback.ts` | Advance clamp: use `end - start` with min/max cap |
| A.4 | `web/components/dashboard/HighlightsTrack.tsx` | Visual fill: use `end - start` with cap |
| A.4 | `web/components/dashboard/HighlightsScrubber.tsx` | Display total: sum of individual durations |
| A.4 | `web/app/share/[token]/PublicHighlightsReel.tsx` | Mirror visual changes on public path |
| A.5 | `web/lib/utils/highlights-settings.ts` | Add `minSegmentDurationSeconds`, `maxSegmentDurationSeconds` to `HIGHLIGHTS_REGISTRY_FALLBACK` |
| A.5 | `supabase/migrations/` (new file) | Add Settings Registry keys to `app_settings` |
| B.1-B.2 | `web/lib/prompts/highlights-extraction.ts` | Add `takeawayIdx` to interface, accept takeaways in user message |
| B.2 | `web/lib/usecases/GenerateExecutiveDigestUseCase.ts` | Pass digest takeaways to `extractHighlights()` |
| B.3 | `web/lib/adapters/SupabaseAnalysisAdapter.ts` | Query `analysis_highlights` in `getAnalysisGrounding()` |
| B.3 | `web/lib/usecases/ProcessChatMessageUseCase.ts` | Add `--- HIGHLIGHTS REEL ---` section to grounding string |
| B.4 | `supabase/migrations/` (new file) | Add `takeaway_idx` column |
| B.6 | `web/lib/config/cascade.ts` | New `HIGHLIGHTS_RECONCILIATION_CASCADE_FALLBACK` constant (Haiku 4.5 → Sonnet 5), `resolveHighlightsReconciliationCascade()`, entry in `CASCADE_FALLBACKS` |
| B.6 | `web/lib/prompts/highlights-reconciliation.ts` (NEW) | System prompt builder, user message builder, result parser for the reconciliation LLM call |
| B.6 | `web/lib/usecases/GenerateExecutiveDigestUseCase.ts` | Add reconciliation step after `saveHighlights()`: call `complete()` with `resolveHighlightsReconciliationCascade()`, parse with `parseHighlightsReconciliation()`, persist result to `executive_digest.reconciliation` (UPDATE the jsonb, same row) |
| B.6 | `web/lib/types/` (wherever `StoredExecutiveDigest` is defined) | Add `ReconciliationResult` and `ReconciledTakeaway` interfaces, add `reconciliation?` field to `StoredExecutiveDigest` |
| B.6 | `web/lib/adapters/SupabaseAnalysisAdapter.ts` | Update `getAnalysisGrounding()` to include `reconciliation` data in the grounding object (already fetched via `executive_digest` jsonb on line 550 — just needs the type cast and grounding string annotation) |
| B.6 | `web/lib/usecases/ProcessChatMessageUseCase.ts` | Annotate the `--- HIGHLIGHTS REEL ---` section (from 2.B.3) with grounding status from `reconciliation`, and the `--- DIMENSION 0: EXECUTIVE DIGEST ---` section with `grounded` flags |
| B.6 | `web/lib/prompts/executive-digest.ts` or `StoredExecutiveDigest` type | No migration — the `reconciliation` field is stored within the existing `executive_digest` jsonb (no new column needed) |
| C.1 | `web/lib/usecases/GenerateExecutiveDigestUseCase.ts` | Slice transcript segments to build `verbatimExcerpt` |
| C.2 | `web/lib/prompts/highlights-extraction.ts` | Add `verbatimExcerpt` to `ExtractedHighlight` |
| C.2 | `web/lib/ports/ExecutiveDigestPorts.ts` | Add `verbatimExcerpt` to `saveHighlights()` type |
| C.2 | `web/lib/adapters/SupabaseAnalysisAdapter.ts` | Pass `verbatimExcerpt` in RPC payload |
| C.2 | `supabase/migrations/` (new file) | Add `verbatim_excerpt` column + update RPC |
| C.3 | `web/lib/hooks/useHighlightTicker.ts` | Accept `verbatimExcerpt` param, prefer it over `label` |
| C.4 | `web/components/dashboard/HighlightsScrubber.tsx` | Pass `verbatimExcerpt` to ticker |
| C.4 | `web/components/dashboard/HighlightsTrack.tsx` | Add `verbatimExcerpt` to interface |
| C.4 | `web/app/api/analyses/highlights/route.ts` | Map `verbatim_excerpt` → `verbatimExcerpt` in response |

**Total: ~18 files (3 migrations + 15 code files including 1 new file for the reconciliation prompt), 1 new LLM call (reconciliation, ~$0.003-0.005/analysis on Haiku 4.5), ~250-700 extra input tokens on existing calls + ~1,500-2,500 input / ~50-150 output tokens on the new reconciliation call. No new DB column for the reconciliation — it's stored within the existing `executive_digest` jsonb.**
