/**
 * UCIS Dimension types
 *
 * Individual dimensions in the UCIS framework, validation helpers,
 * and the canonical dimension name mapping.
 */

import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

/**
 * Individual dimension in the UCIS framework
 * Streamed as JSON fragments: { "dimension": 1, "name": "...", "content": "..." }
 */
export interface UCISDimension {
  /** Dimension number (1-11) */
  number: number;
  /** Dimension name (e.g., "Apex", "Provenance") */
  name: string;
  /** Full content for this dimension */
  content: string;
  /** Optional metadata */
  metadata?: {
    wordCount?: number;
    keyTerms?: string[];
    confidence?: number;
  };
}

/**
 * Validation schema for UCISPayload
 * Used by the Parser (Adapter) when converting JSON → domain entity
 */
export const DIMENSION_NAMES: Record<number, string> = {
  1: 'Apex',
  2: 'Provenance',
  3: 'Architecture',
  4: 'Psychological',
  5: 'CoreIntelligence',
  6: 'Comparative',
  7: 'Implementation',
  8: 'Semantic',
  9: 'Forward',
  10: 'Credibility',
  11: 'Monetization',
};

/**
 * Validate that a dimension number is valid (1-11)
 */
export function isValidDimensionNumber(num: unknown): num is number {
  return typeof num === 'number' && num >= 1 && num <= TOTAL_DIMENSIONS;
}
