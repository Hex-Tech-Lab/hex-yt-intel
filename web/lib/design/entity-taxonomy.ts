/**
 * Single source of truth for entity-type normalization.
 *
 * Two independent write paths have historically produced entity types in
 * two different vocabularies: the worker's legacy 8-value lowercase enum
 * (`person`/`concept`/`framework`/`tool`/`organization`/`study`/`trend`/`metric`,
 * embedded directly in analysis_payload.knowledgeGraph) and the POLE+O
 * capitalized enum enforced by kg_entities' Postgres CHECK constraint
 * (`Person`/`Organization`/`Location`/`Event`/`Object`).
 *
 * POLE+O is canonical because it's the only one actually enforced at the DB
 * layer. Every write path normalizes to it here, at the boundary, before
 * persistence — not at display time. Nothing downstream (entity-colors.ts,
 * useKnowledgeGraph.ts) should ever see the legacy lowercase values.
 *
 * Original values are never discarded: callers that also persist rawNode/
 * raw_node retain the pre-normalization type for future tier-2 use.
 */
export type PoleOType = 'Person' | 'Organization' | 'Location' | 'Event' | 'Object';

const LEGACY_LOWERCASE_TO_POLEO: Record<string, PoleOType> = {
  person: 'Person',
  organization: 'Organization',
  concept: 'Object',
  framework: 'Object',
  tool: 'Object',
  study: 'Object',
  trend: 'Object',
  metric: 'Object',
};

const POLEO_CANONICAL = new Set<PoleOType>(['Person', 'Organization', 'Location', 'Event', 'Object']);

/** Normalizes any known legacy or canonical entity-type spelling to POLE+O. Unknown values fall back to 'Object'. */
export function normalizeEntityType(raw: string | null | undefined): PoleOType {
  if (!raw) return 'Object';
  if (POLEO_CANONICAL.has(raw as PoleOType)) return raw as PoleOType;
  return LEGACY_LOWERCASE_TO_POLEO[raw.toLowerCase()] ?? 'Object';
}
