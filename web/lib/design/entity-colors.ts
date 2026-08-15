/**
 * Single source of truth for knowledge-graph entity category colors.
 *
 * These colors are consumed only by JS components (the WordCloud + MindMap +
 * KnowledgeGraphCanvas), never by a pure-CSS rule, so the palette lives here
 * as design tokens rather than in globals.css. Every component derives its
 * colors from this module — do not re-declare the hues anywhere else.
 */
// The worker's actual KG extraction schema (worker/src/services/ZodSchemas.ts
// KGNodeSchema.entityType) emits a lowercase 8-value enum -- NOT the
// capitalized 5-value POLE+O taxonomy this module previously defined (see
// docs/architecture/entity-colors-poleo-rationale.md for that design's
// original rationale). The mismatch meant every real entity type failed the
// ENTITY_HEX lookup and fell to the gray default, hex-uniformly, across
// WordCloud/MindMap/KnowledgeGraphCanvas simultaneously (live-reported
// "everything went monochrome" bug, 2026-08-15 RCA). Palette now matches the
// worker's real vocabulary directly rather than silently collapsing it into
// POLE+O's 5 categories -- that collapse is a separate, not-yet-decided
// product/IA question, not something to resolve unilaterally in a color fix.
export type EntityType = 'person' | 'concept' | 'framework' | 'tool' | 'organization' | 'study' | 'trend' | 'metric';

/** Base hex per entity type — the one place these values are defined. */
export const ENTITY_HEX: Record<EntityType, string> = {
  person: '#F43F5E', // rose
  organization: '#3B82F6', // blue
  concept: '#A855F7', // purple
  framework: '#0EA5E9', // sky
  tool: '#F97316', // orange
  study: '#10B981', // emerald
  trend: '#EAB308', // yellow
  metric: '#EC4899', // pink
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
