# ADR 023 — Reliable Client-Side Knowledge Graph Fallback for Legacy/Gap Rows

**Status**: approved (2026-08-06), not yet implemented — see the dispatch
prompt at `docs/agent-prompts/2026-08-06-oc-kg-fallback-reliability.md`.

## 1. Origin

Live iPad test, 2026-08-06: "you will notice all dims and meta data are in
but no graphs are there... when I clicked content creator persona all
graphs appeared." Investigated across two passes this session (a background
agent's static-code read, then a live Supabase query against production
data) — root cause is now confirmed with real evidence, not just plausible
candidates.

## 2. Confirmed root cause (live DB query, 2026-08-06)

```sql
SELECT a.id, a.title, a.dimension_count,
  jsonb_array_length(COALESCE(a.analysis_payload->'knowledgeGraph'->'nodes', '[]'::jsonb)) AS payload_kg_node_count,
  (SELECT count(*) FROM kg_entities e WHERE e.analysis_id = a.id) AS kg_entities_row_count
FROM analyses a WHERE a.dimension_count >= 10
ORDER BY a.created_at DESC LIMIT 20;
```

Two distinct patterns exist in production `analyses` rows, both with
`dimension_count = 11` (fully complete analyses):

1. **`payload_kg_node_count > 0`, `kg_entities_row_count = 0`** (e.g. "3 AI
   Video Generators That Are ACTUALLY FREE & UNLIMITED", "Free AI Youtube
   Summarizer" ×3, "Get Free API Keys for Any AI Model" ×2). The
   payload-embedded graph is fine; only the separate `kg_entities`/
   `kg_relations` tables are empty for these rows. **`kg_relations` has
   ZERO rows across the ENTIRE database** — the `/api/analyses/[id]/graph`
   API-fetch path this table backs is effectively dead weight in
   production right now, for every analysis, not just these.
2. **`payload_kg_node_count = 0`, `kg_entities_row_count = 0`** (e.g.
   "Let's build GPT: from scratch, in code, spelled out." —
   `960a99dd-3f60-40c5-aea0-a899c39cba8d` — "5 Best YouTube AI Summary
   Tools", "Vyvanse for ADHD: Why It Works So Well", "What a $90k website
   looks like"). **No knowledge graph data exists anywhere in the database
   for these rows.** Not a display bug — the data was never generated or
   never persisted for these specific analyses (likely predates full KG
   synthesis wiring, or a silent synthesis failure at generation time).

For pattern 2 (the "no graph anywhere" case), the ONLY possible source of a
displayed graph is `web/hooks/useKnowledgeGraph.ts`'s client-side TF-IDF
fallback synthesis, which builds a graph from `analysis.dimensions` (always
present — it's just the parsed markdown, independent of any KG-specific
persistence). Reading that hook's effect chain (`web/hooks/useKnowledgeGraph.ts`
lines ~122-211, both effects) suggests the fallback SHOULD self-trigger on
its own dependency changes without needing an external nudge like a persona
switch — but the live symptom says otherwise. This is the actual unresolved
question this ADR's task scopes: **why doesn't the fallback reliably fire on
restore**, confirmed with a real repro case (the video ID above), not
re-derived from a second static read.

## 3. Scope decision

**In scope**: investigate and fix why `useKnowledgeGraph`'s client-side
fallback synthesis doesn't reliably display for analyses with no persisted
KG data anywhere, using the real repro case identified above. Text/data
layer only — the fallback already exists and is TF-IDF-over-dimension-text,
no video processing, matching the standing "we will not process video"
constraint.

**Also in scope, smaller**: since `kg_relations` is confirmed empty across
the whole database and `kg_entities` is inconsistently populated (present
for some complete analyses, absent for others with identical
`dimension_count`), audit whether the `/api/analyses/[id]/graph` route
(the `kg_entities`/`kg_relations`-backed API path) is worth keeping as the
FIRST-priority graph source in `useKnowledgeGraph.ts`'s effect order, given
it appears to silently fail/return-empty far more often than the
payload-embedded graph does in real production data. Do not change
persistence behavior (don't start writing to `kg_entities`/`kg_relations`
differently) without understanding why they're empty first — that's a
separate, larger investigation (likely the worker-side write path for
those tables) explicitly OUT of scope for this ADR.

**Explicitly out of scope**: retroactively backfilling old rows with a
freshly-generated real graph (would require re-running LLM-based synthesis
against archived markdown — a cost/scope decision for the user, not an
engineering default). Any video/frame/audio processing.

**Optional, propose don't build without sign-off**: a manual "Regenerate
Knowledge Graph" affordance in the UI for analyses that land in the
zero-graph-everywhere state, re-running the SAME client-side TF-IDF
synthesis that already exists (not a new synthesis mechanism) but exposed
as an explicit user action rather than an automatic effect. Only worth
building if the investigation finds the automatic fallback has a
structural reason it can't be made fully reliable (e.g. a legitimate race
that's expensive to close vs. cheap to expose as a manual retry).

## 4. Contract

No new function signatures mandated by this ADR — the task is root-cause
a defect in existing effect logic (`useKnowledgeGraph.ts`) and fix it, not
build new functions. If the investigation concludes a manual regenerate
action is warranted, its contract should be scoped and confirmed with the
user before implementation, not decided unilaterally by whoever implements
this ADR.
