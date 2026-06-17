/**
 * Synthesis Nucleus: Core data model for dynamic persona-aware analysis
 *
 * ARCHITECTURE:
 * - `UCISPayload`: Raw 11-dimension analysis from LLM (always persisted in full)
 * - `PersonaProjection`: Filtered dimensions based on active persona
 * - Zustand store: Manages streaming state + persona filtering
 *
 * DESIGN PRINCIPLE:
 * The frontend ALWAYS receives and persists the FULL analysis.
 * Persona filtering is a VIEW transformation, not a data transformation.
 */

// =============================================================================
// Barrel re-exports for backward compatibility
// =============================================================================
export type { PersonaId, PersonaConfigV2, PersonaProjection } from './persona';
export { PERSONA_DIMENSIONS, isValidPersona } from './persona';
export type { UCISDimension } from './dimension';
export { DIMENSION_NAMES, isValidDimensionNumber } from './dimension';
export type { ClassificationData } from './classification';
export type { MonetizationVerdict } from './monetization';

// =============================================================================
// Internal imports for types still defined in this file
// =============================================================================
import type { PersonaId, PersonaProjection, PersonaConfigV2 } from './persona';
import { PERSONA_DIMENSIONS } from './persona';
import type { UCISDimension } from './dimension';
import type { ClassificationData } from './classification';
import type { MonetizationVerdict } from './monetization';

// =============================================================================
// Individual dimension in the UCIS framework
// =============================================================================

/**
 * Complete UCIS analysis payload (always persisted in full)
 * This is the "Synthesis Nucleus" — the single source of truth for the analysis.
 */
export interface UCISPayload {
  /** Analysis metadata */
  id: string;
  videoId: string;
  title: string;
  channelTitle?: string;
  analysisAt: string;
  completedAt?: string;

  /** Model used for synthesis */
  model: string;

  /** Persona detected by the system */
  detectedPersona: PersonaId;

  /** All 11 dimensions (ALWAYS PERSISTED IN FULL) */
  dimensions: Record<number, UCISDimension>;

  /** Validation metadata */
  validation: {
    passed: boolean;
    errors?: string[];
    warnings?: string[];
  };

  /** Streaming metadata */
  streaming: {
    started: string;
    ended?: string;
    interrupted: boolean;
    dimensionsReceived: number[];
  };
}

/**
 * JSON fragment streamed from Worker
 * Example: { "dimension": 1, "name": "Apex", "content": "...", "metadata": {...} }
 */
export interface UCISStreamFragment {
  type: 'dimension' | 'metadata' | 'complete' | 'error';

  dimension?: number;
  name?: string;
  content?: string;
  metadata?: UCISDimension['metadata'];

  model?: string;
  persona?: PersonaId;

  error?: string;
  code?: string;
}

/**
 * Compute persona projection from full analysis
 * This is the VIEW transformation (filtering is done here, not in the store)
 */
export function computePersonaProjection(
  analysis: UCISPayload | null,
  persona: PersonaId
): PersonaProjection | null {
  if (!analysis) return null;

  const visibleDims = PERSONA_DIMENSIONS[persona];
  const visibleDimensions = visibleDims
    .map(num => analysis.dimensions[num])
    .filter((dim): dim is UCISDimension => Boolean(dim));

  const pendingDimensions = new Set(
    visibleDims.filter(num => !analysis.streaming.dimensionsReceived.includes(num))
  );

  return {
    persona,
    visibleDimensions,
    pendingDimensions,
    progress: {
      received: analysis.streaming.dimensionsReceived.length,
      expected: visibleDims.length,
      percentComplete: visibleDims.length > 0
        ? Math.round((visibleDims.filter(num => analysis.streaming.dimensionsReceived.includes(num)).length / visibleDims.length) * 100)
        : 0,
    },
  };
}

// =============================================================================
// ADR 006: Structured JSON Streaming — v2.0 Interfaces
// =============================================================================

/**
 * Knowledge Graph Node — v2.0 interface
 * Emitted by LLM with explicit entityType for domain-specific semantics.
 */
export interface KGNodeV2 {
  id: string;
  dimension: number;
  label: string;
  content: string;
  weight: number;
  polarity: number;
  keyTerms: string[];
  entityType: 'person' | 'concept' | 'framework' | 'tool' |
              'organization' | 'study' | 'trend' | 'metric';
}

/**
 * Knowledge Graph Edge — v2.0 interface
 * Represents relationships between KG nodes.
 */
export interface KGEdgeV2 {
  source: string;
  target: string;
  strength: number;
  kind: 'similar' | 'related' | 'tangent' | 'contrarian';
  rationale?: string;
}

/**
 * Knowledge Graph structure — v2.0 interface
 */
export interface KnowledgeGraphV2 {
  nodes: KGNodeV2[];
  edges: KGEdgeV2[];
  rootId: string | null;
}

/**
 * Complete UCIS payload — v2.0 interface (ADR 006)
 * Structured JSON payload for dual-write persistence.
 * Mirrors the UCISPayloadV2 Zod schema.
 */
export interface UCISPayloadV2 {
  schemaVersion: '2.0';
  persona: PersonaConfigV2;
  dimensions: UCISDimension[];
  knowledgeGraph: KnowledgeGraphV2;
  classification: ClassificationData;
  monetizationVerdict?: MonetizationVerdict;
}

/**
 * Zustand store for Synthesis Nucleus
 * Manages streaming state + persona filtering
 */
export interface SynthesisNucleusState {
  analysis: UCISPayload | null;

  personaConfig: PersonaConfigV2 | null;
  knowledgeGraph: KnowledgeGraphV2 | null;
  classification: ClassificationData | null;
  monetizationVerdict: MonetizationVerdict | null;

  activePersona: PersonaId;
  projection: PersonaProjection | null;

  isStreaming: boolean;
  streamError: string | null;

  initializeAnalysis: (payload: Partial<UCISPayload>) => void;
  addDimension: (dimension: UCISDimension) => void;
  completeAnalysis: () => void;
  switchPersona: (persona: PersonaId) => void;
  setStreamError: (error: string) => void;
  reset: () => void;

  setPersonaConfig: (config: PersonaConfigV2) => void;
  setKnowledgeGraph: (kg: KnowledgeGraphV2) => void;
  setClassification: (data: ClassificationData) => void;
  setMonetizationVerdict: (verdict: MonetizationVerdict) => void;

  getDimension: (number: number) => UCISDimension | undefined;
  isPersonaComplete: () => boolean;
  getAnalysisForPersist: () => UCISPayload | null;
}
