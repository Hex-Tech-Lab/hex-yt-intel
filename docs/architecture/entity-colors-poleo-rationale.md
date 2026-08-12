# Entity Color Palette — POLE+O Rationale

`web/lib/design/entity-colors.ts` defines the `EntityType` union and color tokens consumed by the knowledge-graph UI components (WordCloud, MindMap, KnowledgeGraphCanvas).

## Why only 5 values (ADR 026 §6.2)

POLE+O (Person/Organization/Location/Event/Object) are the only values `kg_entities.type` can hold going forward, enforced by the `kg_entities_type_poleo_check` constraint (see `supabase/migrations/20260809165422_kg_entity_mentions_normalized.sql`).

The old lowercase categories (`person`/`concept`/`framework`/`tool`/`organization`/`study`/`trend`/`metric`) were removed entirely, not kept alongside the new set — `kg_entities.type` is their only real consumer, and the 2026-08-09 full reclassification (a real LLM pass over all 836 rows, not a blind default) means zero live rows use the old values after that migration.
