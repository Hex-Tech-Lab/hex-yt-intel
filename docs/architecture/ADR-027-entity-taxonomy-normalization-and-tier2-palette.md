# ADR 027: Entity Taxonomy Normalization (POLE+O SSOT) + Domain-Scoped Tier-2 Color Palette

**Date**: 2026-08-16
**Status**: Phase 1 (normalization) implemented this PR. Phase 2 (tier-2 generation + domain-scoped palette) is design-only, scoped for post-launch.

## Context

Two independent write paths produced entity types in two different vocabularies feeding the same rendering components (WordCloud, MindMap, KnowledgeGraphCanvas):

1. `kg_entities` table — POLE+O capitalized (`Person`/`Organization`/`Location`/`Event`/`Object`), enforced by a live Postgres CHECK constraint, 836 real rows.
2. `analysis_payload.knowledgeGraph` JSON blob — the worker's legacy 8-value lowercase enum (`person`/`concept`/`framework`/`tool`/`organization`/`study`/`trend`/`metric`).

`entity-colors.ts` could only recognize one vocabulary at a time, so entities from whichever path it didn't match rendered gray ("everything renders monochrome" bug, root-caused 2026-08-15).

## Decision — Phase 1 (this PR)

POLE+O is canonical, because it's the only vocabulary actually enforced at the database layer (kg_entities' CHECK constraint). A single normalizer, `normalizeEntityType()` in `web/lib/design/entity-taxonomy.ts`, converts both legacy and canonical spellings to POLE+O **at the write boundary**, not at display time:

- `SupabaseGraphAdapter.persistKnowledgeGraph()` normalizes before inserting into `kg_entities`.
- `stitch-analysis-chunks.ts` normalizes worker-chunk node `entityType` before it's stitched into the persisted `analysis_payload.knowledgeGraph`.

`entity-colors.ts` now only needs to know POLE+O's 5 colors — no dual-vocabulary lookup table, no drift risk between two palettes.

**Known gap, explicitly not fixed this PR**: `analysis_payload` rows written *before* this fix still contain unnormalized lowercase values in their stored JSON. There is no backfill for JSON blob data (unlike `kg_entities`, a JSON field can't be fixed with a single SQL UPDATE mapping table). Old analyses may still render some nodes gray until reprocessed or a dedicated backfill script is written. Not blocking launch — new analyses are correct going forward, which is the majority of near-term traffic.

## Decision — Phase 2 (post-launch, design captured now per explicit request)

### Tier-2 vocabulary generation

Not adopting any of Neo4j Labs' `create-context-graph` 22 fixed industry-vertical label sets directly — each is bound to that vertical's specific entities/relationships/agent-tools (e.g. healthcare's `Patient`/`DIAGNOSED_WITH`), and this product is horizontal (any user, any domain), so no single vertical's list transfers.

What *is* adopted is the structural mechanism, validated by Neo4j's own real enterprise usage across 20+ diverse paying industries:

1. **One-time generation pass**, high-capability model (Sonnet 5 / Opus 5 tier) — quality matters here because inventing consistent, non-duplicative category boundaries is a judgment task. Produces a fixed, versioned, schema-validated label list (direct analog to Neo4j's `--custom-domain` flow: LLM generates once, validated against a schema, saved for reuse — not regenerated per video).
2. **Recurring per-video classification**, cheap/fast model — this is closed-set classification against the already-fixed list from step 1, not generation, so a small model (or even embedding-similarity match, no LLM call at all) is sufficient. Quality of the one-time list matters far more than the model used to apply it.

### Tier-2 color palette

Rejected: a unique hue per tier-2 label. Unbounded/unreadable past ~8-10 distinct hues regardless of taxonomy source (independently confirmed via knowledge-graph-visualization literature, not just this product's judgment).

Rejected: tier-1 (POLE+O) coloring only, with tier-2 as label/metadata-only. This under-uses the palette for the common case (a single video only ever belongs to one domain at a time).

**Adopted**: tier-1 (5-6 fixed POLE+O(+Abstract) colors) + a shared tier-2 color pool (~10-14 colors) that is **remapped per detected domain, scoped to a single video's view**. Since one video only ever surfaces one domain's tier-2 categories at a time, the same ~14-color pool can be reused across domains without collision within any single video. Collision only becomes possible in a cross-video aggregate view (the future "Atlas" second-brain feature) where multiple domains' color-reuses could sit side by side — that case is resolved with shape/pattern/brightness variation as the disambiguator, not more hues, reserved for exactly the case that needs it rather than applied everywhere by default.

## Consequences

- Phase 1 is shippable now, zero schema/migration risk, verified via `entity-colors-contract.test.ts` (6/6 passing) and `tsc --noEmit` (clean).
- Phase 2 requires: a domain-detection step per video (what domain is this content in, for palette-remapping purposes), the one-time tier-2 vocabulary generation pass, and the domain→color-index mapping mechanism. None of this is required for launch — the two USPs verified as taxonomy-independent (time-seek, executive digest) are unaffected either way.
- The legacy-payload backfill gap (above) should get its own tracked item before it's forgotten — not filed as a task in this ADR to avoid scope creep, but flagged here so it isn't lost.
