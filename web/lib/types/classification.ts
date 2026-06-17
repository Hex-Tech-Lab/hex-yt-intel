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
  authoritative: boolean;
  practicallyActionable: boolean;
  knowledgeGraphReady: boolean;
  safe: boolean;
  personaOptimised: boolean;
  recommendation: 'highly_recommended' | 'recommended' | 'conditional' | 'skip';
}
