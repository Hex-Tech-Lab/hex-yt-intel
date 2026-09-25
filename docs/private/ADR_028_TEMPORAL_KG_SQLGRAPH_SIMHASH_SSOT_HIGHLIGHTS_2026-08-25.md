# ADR 028 — Temporal Knowledge Graph (SQLGraph) + Latent Semantic Anchor Hash Compression — SSOT Highlights

**Status**: ✅ Decided — confirmed by user (explicit direction 2026-08-25)
**Date**: 2026-08-25
**Version**: 1.0
**Owner**: Kelly B.
**Confidentiality**: Private — not for public repo (per global CLAUDE.md Rule #0; design/strategy)
**Supersedes**: `analysis_highlights` flat-table extraction pattern (Option 1 / MVP)
**Related ADRs**:
- ADR 025 — Entity Mention Index, Compliance Hash (E3 recommendation — this ADR implements it on graph nodes)
- ADR 026 — Grounded Entity Extraction (`kg_entities`/`kg_relations` schema being extended here)
- ADR 019 — Remediation Budget Token Bucket (Settings Registry pattern this ADR inherits)

---

## 1. Executive Summary

The current `analysis_highlights` table is a flat relational artifact extracted three separate times — once for the chat grounding context, once for the highlights reel, and once for D0 snapshots. This produces three inconsistent sets of highlights for the same video (production evidence: reel shows 5, chat shows 10 different ones for the same video ID). There is no single source of truth.

This ADR adopts **Option 3 + Option 4 combined**: a **Temporal Knowledge Graph** modeled in Postgres using the SQLGraph pattern (recursive CTE traversal, no new infrastructure), combined with **Latent Semantic Anchor Hash Compression** (SimHash at the 72h transcript-purge boundary). Together they deliver:

- **SSOT**: a highlight is a graph query result, not a separately extracted artifact
- **No new infrastructure**: SQLGraph on existing Supabase Postgres (no Apache AGE, no Neo4j)
- **Compliance**: verbatim excerpt spans survive until the 72h purge boundary; SimHash compression replaces them at purge time, preserving graph topology and weights (ADR 025 E3, finally implemented)
- **Chat grounding through graph traversal**: Question → Entity → Claim → TemporalNode → Exact Timestamp

---

## 2. Problem

### 2.1 The Production Evidence

Three parallel LLM extractions currently produce three independent highlight lists for the same video:

| Consumer | Extraction path | Observed highlights (same video) |
|---|---|---|
| Highlights reel | `ExtractHighlightsUseCase` → `analysis_highlights` table | 5 |
| Chat grounding | `ProcessChatMessageUseCase` inline extraction | 10 (different ones) |
| D0 snapshot / digest | `GenerateExecutiveDigestUseCase` | Varies; sometimes 0 |

Root cause: no single source of truth for "what are the important moments in this video." Every consumer re-derives its own answer from different prompt shapes, different LLM cascade configs, and different output parsers. There is no data structure that owns this answer once and serves it everywhere.

### 2.2 The Structural Constraint

`analysis_highlights` is a flat relational table (`analysis_id`, `idx`, `start_seconds`, `end_seconds`, `label`). It has no concept of:
- Why a moment is significant (no claim, no argument chain)
- What entities the moment is about (no graph link)
- How confident the extraction was (no salience score)
- Whether it was derived from verbatim text or an LLM judgment (no provenance)

A highlight cannot be traversed — it has no edges. Chat cannot ask "what claim does this highlight support?" without re-querying the LLM. This is Option 1's hard ceiling.

### 2.3 ADR 025 E3 Has Never Been Implemented

ADR 025 §5.5 recommended the E3 compliance pattern (keep verbatim spans alive while the transcript is warm; at 72h purge, replace spans with SimHash + 1-sentence micro-anchor; preserve graph topology post-purge). As of 2026-08-25, the `transcript-purge` webhook deletes transcript rows but performs no semantic compression step. The compliance-grade artifact described in ADR 025 E3 does not exist in production.

---

## 3. Options Considered

### 3.1 Four-School Comparison

| Option | Name | Core idea | Infrastructure | Compliance path | SSOT? | Decision |
|---|---|---|---|---|---|---|
| **1** | Flat relational (current) | `analysis_highlights` table, separate LLM extraction per consumer | None (current Postgres) | None | No | Rejected — three inconsistent extractions |
| **2** | RAPTOR pyramidal summarization | Hierarchical chunk clustering at multiple granularity levels | None new | Unclear — not timestamp-grounded | No | Rejected — high token cost, no timestamp grounding, no compliance path |
| **3** | Temporal Knowledge Graph (SQLGraph) alone | Graph nodes = entities + claims + temporal moments; highlights = graph projection | None new (Supabase Postgres) | None inherent | Yes | Partial — solves SSOT + traversal, no compliance |
| **4** | Latent Semantic Anchor Hash Compression alone | SimHash fingerprints + micro-anchors at 72h purge boundary | None new | Solves ADR 025 E3 directly | No | Partial — solves compliance, no live traversal |
| **3+4** | **Temporal KG + SimHash (this ADR)** | Graph while warm, SimHash compression at 72h boundary | None new | Full ADR 025 E3 | Yes | **ADOPTED** |

### 3.2 Why Not Apache AGE or Neo4j

| Reason | Detail |
|---|---|
| AGE not available on Supabase managed | Apache AGE is a Postgres extension; Supabase managed hosting does not expose it. Requires self-hosted Postgres. |
| Neo4j requires separate infrastructure | Minimum $65/GB/month managed (ADR 026 §8). Enterprise contracts $20K-200K+/year. Not justified at current stage. |
| SQLGraph achieves 90% of query power | TechRAG (independent reimplementation of ROE) proved this using SQLite + SQL JOINs + Python BFS, comparable results (263 entities, 213 facts, `evidence_coverage=0.6`). We already run this pattern (`kg_entities`/`kg_relations` in Postgres) — real, independent, production-validated confirmation. |
| Belvedere's own conclusion | "sometimes the simpler choice... is the right one to start with... it made me reflect on how often, as developers, we tend to over-engineer infrastructure." (ROE research doc §4) |

---

## 4. Decision: Option 3+4 Combined

### 4.1 Core Principle

> **A highlight is a graph query result, not a separately extracted artifact.**

A highlight is a `TemporalNode` (a graph node with `is_temporal_node = true`, `start_ms`, `end_ms`) with a `salience` score above a threshold, connected to a `Claim` node via `CONTAINS_ARGUMENT` edges. Chat grounding follows the path:

```
Question → Entity (by label match / embedding similarity)
         → Claim (via HAS_THEME edge)
         → TemporalNode (via GROUNDED_IN_MOMENT edge)
         → Exact timestamp (start_ms / end_ms)
```

All three consumers (reel, chat, D0) query the same graph. The graph is the SSOT.

### 4.2 Schema Extensions

#### 4.2.1 Extend `kg_entities` (additive ALTER TABLE — no breaking change)

New columns added to the existing `kg_entities` table (established in ADR 026 / PR #226):

```sql
ALTER TABLE public.kg_entities
  ADD COLUMN IF NOT EXISTS salience float,
  ADD COLUMN IF NOT EXISTS claim_text text,
  ADD COLUMN IF NOT EXISTS start_ms bigint,
  ADD COLUMN IF NOT EXISTS end_ms bigint,
  ADD COLUMN IF NOT EXISTS is_temporal_node boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS simhash_64 bigint,
  ADD COLUMN IF NOT EXISTS micro_anchor text;

-- Index on temporal nodes for efficient highlights queries
CREATE INDEX IF NOT EXISTS idx_kge_temporal
  ON public.kg_entities(analysis_id, is_temporal_node, salience DESC)
  WHERE is_temporal_node = true;
```

Column semantics:

| Column | Null while warm | Set at purge | Notes |
|---|---|---|---|
| `salience` | — | Preserved unchanged | ROE-style significance [0.0, 1.0] |
| `claim_text` | verbatim excerpt span | replaced by micro-anchor | Serves UI while warm; legally abstracted post-purge |
| `start_ms` | — | Preserved unchanged | Video timestamp start (milliseconds) |
| `end_ms` | — | Preserved unchanged | Video timestamp end (milliseconds) |
| `is_temporal_node` | — | — | true = TemporalNode (grounded video moment) |
| `simhash_64` | NULL | 64-bit SimHash fingerprint | NULL while warm; non-null = purge complete |
| `micro_anchor` | NULL | 1-sentence semantic anchor | NULL while warm; written at purge boundary |

While `simhash_64` is NULL, `claim_text` holds the verbatim excerpt. At 72h purge, `claim_text` is replaced with the micro-anchor and `simhash_64` is set. No verbatim transcript text survives in this column post-purge.

#### 4.2.2 New `kg_entity_temporal_edges` Table

```sql
CREATE TABLE IF NOT EXISTS public.kg_entity_temporal_edges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id    uuid NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  source_id      uuid NOT NULL REFERENCES public.kg_entities(id) ON DELETE CASCADE,
  target_id      uuid NOT NULL REFERENCES public.kg_entities(id) ON DELETE CASCADE,
  edge_type      text NOT NULL,
  -- Valid edge_type values:
  --   'HAS_THEME'            — Theme/Topic → Claim
  --   'CONTAINS_ARGUMENT'    — Claim → TemporalNode
  --   'GROUNDED_IN_MOMENT'   — Entity → TemporalNode (direct grounding shortcut)
  --   'RELATED_TO'           — general relationship (fallback)
  weight         float,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, source_id, target_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_kgete_analysis_id ON public.kg_entity_temporal_edges(analysis_id);
CREATE INDEX IF NOT EXISTS idx_kgete_source_id   ON public.kg_entity_temporal_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_kgete_target_id   ON public.kg_entity_temporal_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_kgete_edge_type   ON public.kg_entity_temporal_edges(edge_type);

ALTER TABLE public.kg_entity_temporal_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner can read own temporal edges"
  ON public.kg_entity_temporal_edges FOR SELECT TO authenticated
  USING (analysis_id IN (SELECT id FROM public.analyses WHERE user_id = auth.uid()));

REVOKE ALL ON public.kg_entity_temporal_edges FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.kg_entity_temporal_edges FROM authenticated;
```

### 4.3 Graph Topology — Node and Edge Semantics

```
Theme / Topic Node  (is_temporal_node=false, salience=high)
    │
    │  HAS_THEME (weight: relevance strength)
    ▼
Claim Node          (is_temporal_node=false, claim_text="The speaker argues X")
    │
    │  CONTAINS_ARGUMENT (weight: claim-to-moment fit)
    ▼
TemporalNode        (is_temporal_node=true, start_ms=412000, end_ms=427000,
                     salience=0.82, claim_text="verbatim excerpt" → micro_anchor post-purge)
```

**A highlight** = any TemporalNode with `salience >= settings.highlights.minSalientThreshold`, ordered by `salience DESC`. The reel reads the top-N temporal nodes for an analysis; chat traverses from entity → claim → temporal nodes; D0 reads the same top-N temporal nodes. All three read the same rows.

### 4.4 BFS Traversal — SQLGraph Pattern (Recursive CTE)

Graph traversal implemented as a Postgres recursive CTE. No graph database, no extension, no new dependency. This is the "SQLGraph" pattern validated by TechRAG (ROE research doc §3).

```sql
-- Temporal node lookup for a given entity label (parameterized at use-case layer)
WITH RECURSIVE graph_walk AS (
  -- Anchor: start from the entity node matching the query label
  SELECT
    e.id AS node_id,
    e.label,
    e.is_temporal_node,
    e.start_ms,
    e.end_ms,
    e.salience,
    e.claim_text,
    e.simhash_64,
    ARRAY[e.id] AS visited,
    1 AS depth
  FROM public.kg_entities e
  WHERE e.analysis_id = $1          -- analysis_id
    AND e.label ILIKE $2            -- entity label match
    AND e.is_temporal_node = false

  UNION ALL

  -- Traversal: follow edges outward
  SELECT
    target.id,
    target.label,
    target.is_temporal_node,
    target.start_ms,
    target.end_ms,
    target.salience,
    target.claim_text,
    target.simhash_64,
    gw.visited || target.id,
    gw.depth + 1
  FROM graph_walk gw
  JOIN public.kg_entity_temporal_edges edge
    ON  edge.source_id   = gw.node_id
    AND edge.analysis_id = $1
    AND edge.edge_type IN ('HAS_THEME', 'CONTAINS_ARGUMENT', 'GROUNDED_IN_MOMENT')
  JOIN public.kg_entities target
    ON  target.id = edge.target_id
    AND target.id != ALL(gw.visited)    -- cycle guard (prevents infinite loops)
  WHERE gw.depth < $3                  -- settings.highlights.graph.maxDepth
)
SELECT *
FROM graph_walk
WHERE is_temporal_node = true
  AND salience >= $4                   -- settings.highlights.minSalientThreshold
ORDER BY salience DESC
LIMIT $5;                             -- settings.highlights.graph.maxNodes
```

The cycle guard (`id != ALL(visited)`) ensures safe BFS on arbitrary graph topologies without a dedicated graph engine.

### 4.5 ROE Hard Caps → Settings Registry Keys

Derived from the ROE reference architecture (confirmed production numbers from both the original ROE implementation and TechRAG's independent reimplementation). Not hardcoded — Settings Registry following ADR 019 pattern.

| Settings Registry Key | Initial value | Derivation |
|---|---|---|
| `highlights.graph.maxAtomicFacts` | `10` | ROE hard cap: ≤10 atomic facts per LLM context bundle |
| `highlights.graph.maxNodes` | `24` | ROE hard cap: ≤24 nodes per LLM context bundle |
| `highlights.graph.maxEdges` | `18` | ROE hard cap: ≤18 edges per LLM context bundle |
| `highlights.graph.maxPaths` | `12` | ROE hard cap: ≤12 traversal paths per query |
| `highlights.graph.maxDepth` | `6` | BFS depth limit; ROE paths imply ~4-6 hops for HAS_THEME → CLAIM → TEMPORAL |
| `highlights.minSalientThreshold` | `0.60` | Initial floor; tune from real production salience distributions post Phase 2 |
| `highlights.maxReelNodes` | `10` | Consumer-facing cap (reel nodes shown to user); distinct from graph traversal caps |

**Before bumping any of these constants**: pull real production telemetry, correlate against real outcomes, derive the new value empirically with a reasoned margin — per AGENTS.md §6 "No setting without empirical backing." Initial values above are the ROE-validated production numbers as a starting floor, not arbitrary guesses.

---

## 5. Compliance: ADR 025 E3 Implementation on Graph Nodes

### 5.1 Two Phases of Retention

| Phase | Condition | What TemporalNode stores | Graph topology |
|---|---|---|---|
| **Warm** | `simhash_64 IS NULL` (transcript ≤72h old) | `claim_text` = verbatim excerpt span from transcript | Full edges + weights preserved |
| **Purged** | `simhash_64 IS NOT NULL` (post 72h purge) | `claim_text` = 1-sentence micro-anchor; `simhash_64` = 64-bit fingerprint | Full edges + weights preserved; salience preserved |

The graph **remains fully traversable** after purge. Entity → Claim → TemporalNode traversal still works. The only change is that `claim_text` is no longer verbatim and `simhash_64` is non-null.

### 5.2 SimHash Compression Step

Added to `transcript-purge/route.ts` before transcript row deletion:

```typescript
// Phase 4 — pseudocode (real implementation goes through proper branch + review)
async function compressTemporalNodesBeforePurge(analysisId: string): Promise<void> {
  const temporalNodes = await getTemporalNodesWithVerbatimText(analysisId);
  // where simhash_64 IS NULL (not yet compressed)
  for (const node of temporalNodes) {
    const hash = simHash64(node.claim_text);      // 64-bit SimHash fingerprint (O(n), deterministic)
    const anchor = await deriveMicroAnchor(node); // 1-sentence re-derivation (see §5.3)
    await updateTemporalNode(node.id, {
      simhash_64: hash,
      claim_text: anchor,                         // replaces verbatim span
    });
  }
}
```

**SimHash algorithm**: 64-bit SimHash (Charikar 2002). Preserves semantic similarity (low Hamming distance = similar content). Pure TypeScript, no external dependency, ~50 lines. Not a cryptographic hash — designed specifically for near-duplicate detection.

### 5.3 Micro-Anchor Derivation Options (Legal Review Required — Q1)

| Option | Cost | Quality | Legal risk |
|---|---|---|---|
| Extractive heuristic: take first/highest-TF-IDF sentence of verbatim span | $0 | Adequate | Lower (purely mechanical, no LLM interpretation) |
| LLM generation: 1-call Haiku 4.5 per node at purge | ~$0.0005/analysis | Higher semantic fidelity | Slightly higher (LLM paraphrase of original) |

Legal sign-off (Q1) determines which option ships in Phase 4.

### 5.4 Relationship to ADR 025

ADR 025 §5.5 (Problem B, E3) recommended: "keep short verbatim spans until 72h purge (serves the live UI), then at purge time, re-derive and hash a fully-abstracted E2-style permanent record." This ADR implements exactly that recommendation on **graph nodes** (`kg_entities` TemporalNodes) rather than on the flat `EntityMentionIndex` ADR 025 originally proposed. The `EntityMentionIndex` structure is not built — the Temporal KG supersedes it with richer traversal semantics.

ADR 025 Phase 4 (compliance reduction + hash) is superseded by this ADR's Phase 4.

---

## 6. Migration Path (Option 1 → Option 3+4, Zero Downtime)

All phases are additive. `analysis_highlights` is kept as a read fallback through Phase 3.

| Phase | Scope | Breaking change? | Precondition |
|---|---|---|---|
| **Phase 1** | Schema: `ALTER TABLE kg_entities ADD COLUMN ...` (§4.2.1); `CREATE TABLE kg_entity_temporal_edges` (§4.2.2); Settings Registry keys seeded (§4.5) | None — additive only | This ADR confirmed (done) + Q3 + Q5 sign-off |
| **Phase 2** | Wire `ExtractHighlightsUseCase` to populate TemporalNodes + edges instead of `analysis_highlights` rows; dual-write both for transition period | None — dual-write | Phase 1 schema migrated |
| **Phase 3** | Rewrite consumers (reel, chat grounding, D0) from `SELECT * FROM analysis_highlights` to recursive CTE graph traversal; verify SSOT in production on ≥10 real analyses; stop dual-write | Internal only — no public API change | Phase 2 verified on ≥10 analyses |
| **Phase 4** | SimHash compression step in `transcript-purge` webhook (ADR 025 E3); legal sign-off required before shipping | None to existing users | Phase 3 in production + Q1 legal sign-off |
| **Phase 5** *(future, gated)* | Evaluate Apache AGE or Neo4j for cross-video Atlas traversal at scale | Gated | Atlas product requirement confirmed by Kelly |

### 6.1 Rollback Plan

- **Phase 1-2**: stop dual-write; `analysis_highlights` continues to serve consumers unchanged.
- **Phase 3**: switch consumers back to `SELECT * FROM analysis_highlights` (table kept intact).
- **Phase 4**: disable the SimHash step; verbatim spans survive longer than legally required (over-conservative, not dangerous).

---

## 7. Cost Model

| Line item | Cost delta vs. current |
|---|---|
| Schema extension (Phase 1) | Negligible — additive columns + partial index |
| TemporalNode extraction (Phase 2) | $0 net — re-uses existing `ExtractHighlightsUseCase` LLM call with extended output schema |
| Graph traversal / BFS (Phase 3) | <10ms per query on Supabase Postgres at ≤24 nodes; no O(n²) joins with cycle guard + depth cap |
| SimHash computation (Phase 4) | <1ms per node — O(n) in string length, pure compute |
| Micro-anchor derivation (Phase 4, LLM path) | ~$0.0005/analysis at purge (10 nodes × Haiku 4.5 micro-anchor call) — negligible |

---

## 8. What Stays / What Changes

| Component | Status | Notes |
|---|---|---|
| `kg_entities` table | Extended (additive) | New columns only; existing rows unaffected |
| `kg_relations` table | Unchanged | Existing KG edges continue to use current schema |
| `analysis_highlights` table | Deprecated (Phase 3+) | Kept as read fallback through Phase 2-3 transition; not dropped until SSOT verified |
| `ExtractHighlightsUseCase` | Rewritten (Phase 2) | Writes TemporalNodes + edges instead of `analysis_highlights` rows |
| `GenerateExecutiveDigestUseCase` highlights fallback | Demoted (Phase 3) | Reads from graph traversal instead of inline extraction |
| `ProcessChatMessageUseCase` inline highlight extraction | Removed (Phase 3) | Chat grounding traverses graph instead of re-extracting |
| `transcript-purge/route.ts` | Extended (Phase 4) | SimHash compression step added before transcript row deletion |
| ROE hard caps | Settings Registry keys (Phase 1) | Tunable; not hardcoded; empirically backed from ROE production data |

---

## 9. Alternatives Considered (Summary)

| Option | Rejected reason |
|---|---|
| Option 1 (flat table, current) | Proven to produce inconsistent results in production; no SSOT; no traversal; no compliance path |
| Option 2 (RAPTOR pyramidal) | High token cost per analysis; no timestamp grounding; no compliance path; overkill for single-video use case |
| Option 3 alone | Solves SSOT + traversal; no ADR 025 E3 compliance path |
| Option 4 alone | Solves compliance; no live traversal without a graph structure |
| Apache AGE | Not available on Supabase managed hosting |
| Neo4j | $65-146/GB/month managed — 260-580× more expensive per GB than current infra; requires separate infrastructure; not justified at current stage |

---

## 10. Open Questions (Needing Sign-Off Before Phase Start)

| # | Question | Blocks | Owner |
|---|---|---|---|
| **Q1** | **Legal review of E3 compliance approach**: does replacing verbatim spans with SimHash + 1-sentence micro-anchor satisfy the "derivative, non-reproducible work" bar in the privacy policy? Which micro-anchor derivation method (extractive heuristic vs. LLM generation) is legally sufficient? | Phase 4 only | Kelly + legal |
| **Q2** | **Salience scoring method**: LLM-emitted score during extraction (semantically faithful, slight LLM cost), TF-IDF + duration heuristic (ADR 025 A4, free), or hybrid? | Phase 2 | Kelly |
| **Q3** | **`kg_entity_temporal_edges` vs. reusing `kg_relations`**: separate table (proposed — cleaner semantics, independent RLS/index) or reuse `kg_relations` with `edge_type` discriminator? | Phase 1 | Kelly |
| **Q4** | **`highlights.minSalientThreshold = 0.60`**: acceptable as a Phase 2/3 starting value, with mandatory empirical re-evaluation after ≥30 real analyses generate salience data? | Phase 2/3 | Kelly |
| **Q5** | **Phase 1 standalone PR**: acceptable to ship schema migration (Phase 1 only) as a standalone zero-risk PR now, decoupled from Phase 2 extraction wiring? (Recommended: yes) | Phase 1 | Kelly |

**Phase 1 migration can begin once Q3 and Q5 are signed off.** Q1 is Phase 4 only. Q2 and Q4 are Phase 2+ only.

---

## 11. Confirmed by User

Yes — this ADR is written per explicit user direction 2026-08-25. The Option 3+4 combined architecture is the confirmed path forward.

---

## 12. Key Decisions (Condensed)

1. **SSOT**: highlights are graph traversal results, not a separately extracted artifact. `analysis_highlights` flat table is deprecated (Phase 3+).
2. **SQLGraph** (recursive CTE, Supabase Postgres) achieves 90% of Neo4j's query power at zero new infrastructure cost — validated by TechRAG's independent reimplementation of ROE.
3. **No Apache AGE, no Neo4j** — Supabase managed doesn't support AGE; Neo4j is 260-580× more expensive per GB and requires separate infrastructure; SQLGraph is the right choice at current scale.
4. **TemporalNode** = a `kg_entities` row with `is_temporal_node=true`, `start_ms`, `end_ms`, `salience`, `claim_text`. A highlight = high-salience TemporalNode.
5. **HAS_THEME → CONTAINS_ARGUMENT → GROUNDED_IN_MOMENT** traversal path enables chat grounding from entity label to exact timestamp without a new LLM call.
6. **ROE hard caps** (≤10 facts / ≤24 nodes / ≤18 edges / ≤12 paths) go into Settings Registry — not hardcoded; tunable; empirically backed from ROE production data; require real telemetry before adjustment.
7. **SimHash at 72h purge boundary** replaces verbatim excerpt spans with `simhash_64` + `micro_anchor`. Graph topology (edges, weights, salience) is preserved post-purge. This is ADR 025 E3 finally implemented.
8. **Zero-downtime migration**: 5-phase additive path; `analysis_highlights` kept as fallback through Phase 3; clean rollback at every phase.
9. **Phase 5 (AGE/Neo4j)** is gated on the cross-video Atlas product requirement being confirmed — deliberately deferred.

## Addendum (2026-09-26): Highlights Coverage & Overlap
The harvest strategy now allocates a strict quota of windows spread across the *entire* duration of the video to avoid front-loading (especially for >3h videos). Failed windows are tracked and retried; a reel is never replaced if the new harvest falls below the coverage threshold. The chronological slice respects boundaries exactly to prevent segment skipping.
