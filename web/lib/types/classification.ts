/**
 * Classification domain types
 *
 * Classification data from ADR 006 structured JSON streaming.
 * Used by the synthesis pipeline to tag analysis quality and actionability.
 */

/**
 * Classification data — v2.0 interface
 */
export interface ClassificationData {
  authoritative?: boolean | null;
  practicallyActionable?: boolean | null;
  knowledgeGraphReady?: boolean | null;
  safe?: boolean | null;
  personaOptimised?: boolean | null;
  recommendation: 'highly_recommended' | 'recommended' | 'conditional' | 'skip';
}
