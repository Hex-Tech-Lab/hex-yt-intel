# ADR 022 — Per-Mention Entity Timestamp Resolution (Fixing Entity-Seek Clustering)

**Status**: approved (2026-08-06), not yet implemented — see the dispatch
prompt at `docs/agent-prompts/2026-08-06-oc-per-mention-entity-timestamps.md`.

## 1. Origin

Live iPad test, 2026-08-06: entity-click video-seek was reported as "shite —
they all jump to pretty much the same thing... one or two in the last third,
the rest in the first minute." Separately, the same session's WordCloud
investigation found a visually-clustering highlight bug (many differently-
sized words all highlighting together on a single click) with the **same
root cause**: `web/components/templates/console/WordCloud.tsx`'s
`tokenMap` collapses many transcript-derived words onto one shared KG node
`id`, and every consumer of that `id` — including the seek path — treats
"the node" as having exactly one canonical timestamp.

The WordCloud highlight symptom was fixed directly in PR #207 (a client-side
`wordKey` workaround, scoped to that one component). This ADR addresses the
deeper, shared cause: **`findEntityTimestamp` (`web/lib/utils/entity-time-seek.ts`)
always resolves to the FIRST occurrence of an entity's label in the
dimension content**, via `dimensionContent.indexOf(label)` — a single,
un-indexed lookup, not a search over all occurrences. Every click on that
entity, from every panel (WordCloud, KnowledgeGraphCanvas, MindMap,
IntelligencePanel), resolves to the identical timestamp, every time. This is
the actual cause of "most jump to the same place."

## 2. Research basis (external prior art)

User-supplied research (three passes: an architectural analysis, a GitHub/
Reddit source list, and a follow-up GitHub-tools list) converged on one
diagnosis from three angles:

- **Graph-DB pattern** (Neo4j-style): don't store a timestamp *on* the
  entity node — connect the entity to `Mention`/`Chunk` nodes via a typed,
  multi-valued edge (`(e:Entity)-[:APPEARS_IN {offset, timestamp}]->(c:Chunk)`).
- **Lightweight/in-memory pattern** (Reddit r/KnowledgeGraph, NetworkX):
  same idea without a graph DB — an edge/field holding an *array* of
  timestamps (`timestamps: [12, 105, 190]`), or a typed dataclass carrying a
  mention list. This is the pattern that actually fits our stack (Supabase
  Postgres + Zustand, no graph DB).
- **Frontend pattern**: each *rendered token instance* needs its own stable
  identity distinct from the entity's node id, so a click resolves
  `mentionId → seekSeconds`, not `nodeId → seekSeconds`.
- **Reference implementations** cited: `thoughtpunch/claudetube`,
  `abramovd/yt-semantic-search`, `transitive-bullshit/yt-semantic-search`,
  `Fer14/videoseek`, `PetrKorab/Animated-Word-Cloud`,
  `zaidmukaddam/youtube-transcripts-machine` — all converge on the same
  shape: transcript token → offset → occurrence record, never collapsed
  before reaching the UI.

**Explicitly out of scope, noted for future reference only**: several cited
repos pair per-mention timestamps with *video* processing —
`claudetube`'s `get_frames_at(video_id, start_time)` (frame extraction) and
`transitive-bullshit/yt-semantic-search`'s `generate-thumbnails.ts`
(thumbnail-per-mention). **hex-yt-intel does not process video and this ADR
does not propose starting** — transcript/dimension text is the only input.
If frame/thumbnail extraction is ever revisited, the pattern to reuse is
"key the auxiliary artifact to a mention record, not a node id" — the same
lesson this ADR applies to timestamps.

## 3. Scope decision: v1 is text-layer only, no schema/pipeline change

The full graph-DB-style model (mentions as a first-class array on
`GraphNode`, populated during `KnowledgeGraphSynthesizer.synthesize()`,
persisted, threaded through the worker) is the "correct" long-term shape,
but it's a multi-file architecture change (client synthesizer, worker
synthesis path, `GraphNode` type, persistence, every consumer of
`node.id`-based seeking) for a bug whose actual fix doesn't need any of
that: **`findEntityTimestamp` already re-derives a timestamp from dimension
text on every call — it just stops at the first match.** The dimension
content and inline `[MM:SS]` markers already ARE the mention data; they're
just not being fully searched.

**v1 (this ADR, scoped for immediate implementation)**: extend
`entity-time-seek.ts` to find and return ALL matching occurrences of an
entity's label within the dimension content (not just the first), each
resolved to its own timestamp via the existing chapter-boundary-snapping
logic (unchanged). Callers (`DashboardContainer.handleSelectNode`) pick
**the occurrence nearest to the video's current playback position** — not
always the first, and not a hardcoded index — which is a better UX outcome
than either "always first" (today's bug) or "cycle through on repeat click"
(stateful, more complex, no clear win). If no playback position is
available (nothing has played yet), fall back to the first occurrence
(today's behavior, unchanged for that case).

**v2 (explicitly NOT this ADR — future work, contingent)**: if the app ever
grows a real position-indexed transcript store (word-level timestamps from
an ASR pass, not regex-extracted inline markers from LLM prose), promote
mentions to a first-class `GraphNode.mentions: EntityMention[]` field
populated at synthesis time, matching the graph-DB pattern above. Not
proposed now because the current dimension-text-only data source doesn't
have per-word ASR timing to justify it — the regex-based inline-marker
extraction this ADR improves is already the ceiling of what text-only
mention resolution can deliver.

## 4. Contract

```ts
// entity-time-seek.ts — new exported function, findEntityTimestamp's
// existing behavior/signature UNCHANGED (still used wherever "just give me
// a timestamp, no playback-position context" is sufficient).
export interface EntityMentionMatch {
  timestamp: string;       // "MM:SS" / "HH:MM:SS", chapter-boundary-snapped
  seekSeconds: number;     // parsed, for distance-to-playhead comparison
  occurrenceIndex: number; // 0-based position among all matches for this entity
}

export function findAllEntityMentions(
  node: EntityTimeSeekNode,
  dimensionContent?: string | null,
  chapters?: EntityTimeSeekChapter[] | null,
): EntityMentionMatch[];

// Picks the mention nearest currentPlaybackSeconds; falls back to the
// first mention if currentPlaybackSeconds is null/undefined (nothing
// played yet) or there are no mentions.
export function findNearestEntityMention(
  node: EntityTimeSeekNode,
  dimensionContent: string | null | undefined,
  chapters: EntityTimeSeekChapter[] | null | undefined,
  currentPlaybackSeconds: number | null,
): EntityMentionMatch | null;
```

`DashboardContainer.handleSelectNode` switches from
`findEntityTimestamp(node, dimContent, chapters)` to
`findNearestEntityMention(node, dimContent, chapters, useVideoStore.getState().currentPlaybackSeconds ?? null)`
— check whether `useVideoStore` already tracks current playback position
(likely, for the player UI itself); if not, that's a small addition to
`useVideoStore`, not a new subsystem.

## 5. Non-goals

- No change to `WordCloud.tsx`'s PR #207 `wordKey` fix — it solves a
  different problem (visual highlight identity) and stays as-is. Once this
  ADR's fix lands, WordCloud's clicks will *also* seek to a better-chosen
  timestamp (inherited for free, since it goes through the same
  `handleSelectNode`), but that's a side effect, not this ADR's target.
- No new database table, no worker change, no persistence-schema change.
- No video/audio processing of any kind.
