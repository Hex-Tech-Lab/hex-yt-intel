/**
 * Single source of truth for knowledge-graph entity category colors.
 *
 * These colors are consumed only by JS components (the WordCloud + MindMap +
 * KnowledgeGraphCanvas), never by a pure-CSS rule, so the palette lives here
 * as design tokens rather than in globals.css. Every component derives its
 * colors from this module — do not re-declare the hues anywhere else.
 */
export type EntityType =
  | 'person'
  | 'concept'
  | 'framework'
  | 'tool'
  | 'organization'
  | 'study'
  | 'trend'
  | 'metric';

/** Base hex per entity type — the one place these values are defined. */
export const ENTITY_HEX: Record<EntityType, string> = {
  person: '#F43F5E', // rose
  concept: '#A855F7', // purple
  framework: '#EAB308', // yellow
  tool: '#06B6D4', // cyan (== --accent)
  organization: '#3B82F6', // blue
  study: '#10B981', // emerald
  trend: '#F97316', // orange
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
