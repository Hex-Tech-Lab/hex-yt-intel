/**
 * Single source of truth for knowledge-graph entity category colors.
 *
 * These colors are consumed only by JS components (the WordCloud + MindMap +
 * KnowledgeGraphCanvas), never by a pure-CSS rule, so the palette lives here
 * as design tokens rather than in globals.css. Every component derives its
 * colors from this module — do not re-declare the hues anywhere else.
 */
// ADR 026 §6.2 POLE+O base types — the only values kg_entities.type can hold
// going forward (enforced by kg_entities_type_poleo_check). The old lowercase
// categories (person/concept/framework/tool/organization/study/trend/metric)
// were removed, not kept alongside these: kg_entities.type is their only real
// consumer, and 2026-08-09's full reclassification (not a blind default) means
// zero live rows use the old values after that migration completes.
export type EntityType = 'Person' | 'Organization' | 'Location' | 'Event' | 'Object';

/** Base hex per entity type — the one place these values are defined. */
export const ENTITY_HEX: Record<EntityType, string> = {
  Person: '#F43F5E', // rose
  Organization: '#3B82F6', // blue
  Location: '#10B981', // emerald
  Event: '#F97316', // orange
  Object: '#A855F7', // purple, the POLE+O catch-all
};

/** Fallback for unknown / missing entity types (slate-400). */
export const ENTITY_DEFAULT_HEX = '#94A3B8';

/** "r g b" (space-separated) for use in modern `rgb(<t> / <a>)` strings. */
function hexToRgbTriplet(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export const ENTITY_RGB: Record<EntityType, string> = Object.fromEntries(
  (Object.entries(ENTITY_HEX) as [EntityType, string][]).map(([k, v]) => [k, hexToRgbTriplet(v)]),
) as Record<EntityType, string>;

export const ENTITY_DEFAULT_RGB = hexToRgbTriplet(ENTITY_DEFAULT_HEX);

/** Hex for a (possibly unknown) entity type. */
export function entityHex(type: string | null | undefined): string {
  return ENTITY_HEX[type as EntityType] ?? ENTITY_DEFAULT_HEX;
}

/** "r g b" triplet for a (possibly unknown) entity type. */
export function entityRgb(type: string | null | undefined): string {
  return ENTITY_RGB[type as EntityType] ?? ENTITY_DEFAULT_RGB;
}
