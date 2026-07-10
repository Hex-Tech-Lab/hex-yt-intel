/**
 * Persona domain types
 *
 * Persona identifiers, dimension projections, and persona configuration.
 * Persona filtering is a VIEW transformation, not a data transformation.
 */

import type { UCISDimension } from './dimension';

export type PersonaId = 'creator' | 'indieMaker' | 'consultant' | 'researcher' | 'productManager';

export const VALID_PERSONAS = ['creator', 'indieMaker', 'consultant', 'researcher', 'productManager'] as const;

/**
 * Persona-specific dimension projection
 * Maps PersonaId → array of dimension numbers visible in that persona
 */
// PRD primary personas (ids kept stable; labels in PersonaSelector).
// Content Creator (P1) is the apex persona → ALL 11 dimensions (it needs the full
// picture: objects, market, financials, SEO, search, everything).
export const PERSONA_DIMENSIONS: Record<PersonaId, number[]> = {
  creator: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // P1 Content Creator — everything
  indieMaker: [1, 3, 5, 6, 7, 11], // P2 Indie Maker — build, core, comparative, implement, monetize
  consultant: [1, 2, 5, 8, 10, 11], // P3 Consultant — provenance, core, semantic, credibility, yield
  researcher: [1, 4, 5, 8, 9], // P4 Researcher — psychological, core, semantic, forward
  productManager: [1, 3, 5, 6, 9], // P5 Product Manager — architecture, core, comparative, forward
};

/**
 * What the UI sees: filtered dimensions based on active persona
 * Computed state derived from `UCISPayload` + `activePersona`
 */
export interface PersonaProjection {
  /** Active persona */
  persona: PersonaId;

  /** Dimensions visible in this persona */
  visibleDimensions: UCISDimension[];

  /** For UI: which dimensions are still pending (streaming) */
  pendingDimensions: Set<number>;

  /** Streaming progress */
  progress: {
    received: number;
    expected: number;
    percentComplete: number;
  };
}

/**
 * Persona configuration — v2.0 interface
 * Structured replacement for the text header block.
 */
export interface PersonaConfigV2 {
  primary: { id: PersonaId; label: string; weight: number };
  secondary?: { id: PersonaId; label: string; weight: number };
  tertiary?: { id: PersonaId; label: string; weight: number };
  cognitiveLenses: string[];
  selectionRationale: string;
}

/**
 * Validate that a persona ID is valid
 */
export function isValidPersona(persona: unknown): persona is PersonaId {
  if (typeof persona !== 'string') return false;
  return VALID_PERSONAS.includes(persona as PersonaId);
}
