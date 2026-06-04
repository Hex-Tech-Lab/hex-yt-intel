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
 * Complete UCIS analysis payload (always persisted in full)
 * This is the "Synthesis Nucleus" — the single source of truth for the analysis.
 */
export interface UCISPayload {
  /** Analysis metadata */
  id: string;
  videoId: string;
  title: string;
  channelTitle?: string;
  analysisAt: string; // ISO timestamp when analysis started
  completedAt?: string; // ISO timestamp when analysis completed

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
    dimensionsReceived: number[]; // Track which dimensions arrived
  };
}

/**
 * Persona identifiers (subset of full persona list)
 */
export type PersonaId = 'creator' | 'critic' | 'analyst' | 'educator' | 'philosopher';

/**
 * Persona-specific dimension projection
 * Maps PersonaId → array of dimension numbers visible in that persona
 */
// PRD primary personas (ids kept stable; labels in PersonaSelector).
// Content Creator (P1) is the apex persona → ALL 11 dimensions (it needs the full
// picture: objects, market, financials, SEO, search, everything).
export const PERSONA_DIMENSIONS: Record<PersonaId, number[]> = {
  creator: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // P1 Content Creator — everything
  critic: [1, 3, 5, 6, 7, 11], // P2 Indie Maker — build, core, comparative, implement, monetize
  analyst: [1, 2, 5, 8, 10, 11], // P3 Consultant — provenance, core, semantic, credibility, yield
  educator: [1, 4, 5, 8, 9], // P4 Researcher — psychological, core, semantic, forward
  philosopher: [1, 3, 5, 6, 9], // P5 Product Manager — architecture, core, comparative, forward
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
 * Zustand store for Synthesis Nucleus
 * Manages streaming state + persona filtering
 */
export interface SynthesisNucleusState {
  // ============= RAW ANALYSIS (Always persisted in full) =============
  /** Full UCISPayload from LLM (source of truth) */
  analysis: UCISPayload | null;

  // ============= PERSONA VIEW (Derived/computed state) =============
  /** Active persona for filtering */
  activePersona: PersonaId;

  /** Computed projection (what UI renders) */
  projection: PersonaProjection | null;

  // ============= STREAMING STATE =============
  /** Is analysis currently streaming? */
  isStreaming: boolean;

  /** Current streaming error (if any) */
  streamError: string | null;

  // ============= ACTIONS =============
  /** Initialize analysis (called when /api/analyses returns 202) */
  initializeAnalysis: (payload: Partial<UCISPayload>) => void;

  /** Add a dimension as it arrives from stream */
  addDimension: (dimension: UCISDimension) => void;

  /** Mark analysis as complete */
  completeAnalysis: () => void;

  /** Switch to a different persona (NO re-streaming required) */
  switchPersona: (persona: PersonaId) => void;

  /** Mark streaming as errored */
  setStreamError: (error: string) => void;

  /** Clear all analysis state (for new analysis) */
  reset: () => void;

  // ============= HELPERS =============
  /** Get dimension by number */
  getDimension: (number: number) => UCISDimension | undefined;

  /** Check if all expected dimensions for active persona have arrived */
  isPersonaComplete: () => boolean;

  /** Export full analysis for persistence */
  getAnalysisForPersist: () => UCISPayload | null;
}

/**
 * JSON fragment streamed from Worker
 * Example: { "dimension": 1, "name": "Apex", "content": "...", "metadata": {...} }
 */
export interface UCISStreamFragment {
  type: 'dimension' | 'metadata' | 'complete' | 'error';

  // For 'dimension' fragments
  dimension?: number;
  name?: string;
  content?: string;
  metadata?: UCISDimension['metadata'];

  // For 'metadata' fragments
  model?: string;
  persona?: PersonaId;

  // For 'error' fragments
  error?: string;
  code?: string;
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
  return typeof num === 'number' && num >= 1 && num <= 11;
}

/**
 * Validate that a persona ID is valid
 */
export function isValidPersona(persona: unknown): persona is PersonaId {
  return ['creator', 'critic', 'analyst', 'educator', 'philosopher'].includes(String(persona));
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
