/**
 * Monetization domain types
 *
 * Monetization verdicts from ADR 006 structured JSON streaming.
 * Contains persona-specific monetization recommendations.
 * Keys are aligned with PersonaId for type safety.
 */

import type { PersonaId } from './persona';

/**
 * Monetization verdicts — v2.0 interface
 * Type-safe record keyed by PersonaId.
 */
export type MonetizationVerdict = Record<PersonaId, string>;
