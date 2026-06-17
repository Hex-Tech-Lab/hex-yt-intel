/**
 * Monetization domain types
 *
 * Monetization verdicts from ADR 006 structured JSON streaming.
 * Contains persona-specific monetization recommendations.
 */

/**
 * Monetization verdicts — v2.0 interface
 */
export interface MonetizationVerdict {
  creator: string;
  indieMaker: string;
  consultant: string;
  researcher: string;
  productManager: string;
}
