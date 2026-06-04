/**
 * Synthesis Nucleus Zustand Store
 *
 * CRITICAL DESIGN PATTERN:
 * - `analysis`: IMMUTABLE raw 11-dimension payload (always persisted in full)
 * - `activePersona`: Mutable persona selector (USER can switch mid-stream)
 * - `projection`: COMPUTED view (derived from `analysis` + `activePersona`)
 *
 * EDGE CASE (User switches personas while streaming):
 * 1. User sees partial analysis for Persona A (e.g., Creator: 5/5 dimensions visible)
 * 2. Stream continues in background, filling ALL 11 dimensions
 * 3. User clicks "Switch to Analyst" → projection IMMEDIATELY updates
 * 4. New persona sees MORE dimensions (8/8 visible) than were previously streamed
 * 5. Some new dimensions still pending → UI shows shimmer/skeleton for new ones
 * 6. As stream continues, those pending dimensions fill in
 * 7. When stream ends, ALL 11 dimensions persisted to DB
 *
 * GUARANTEE: No data is lost. User can switch personas freely. Full analysis always saved.
 */

import { create } from 'zustand';
import {
  type SynthesisNucleusState,
  type UCISPayload,
  type UCISDimension,
  type PersonaId,
  computePersonaProjection,
  PERSONA_DIMENSIONS,
  isValidDimensionNumber,
  isValidPersona,
} from '@/lib/types/synthesis-nucleus';

/**
 * Create the Synthesis Nucleus store
 * Manages both raw data + persona-aware filtering
 */
export const useSynthesisNucleus = create<SynthesisNucleusState>((set, get) => ({
  // ============= INITIAL STATE =============
  analysis: null,
  activePersona: 'analyst', // Default persona
  projection: null,
  isStreaming: false,
  streamError: null,

  // ============= ACTIONS =============

  /**
   * Initialize a new analysis (called when /api/analyses returns 202)
   * Sets up the raw payload structure before streaming begins
   */
  initializeAnalysis: (payload: Partial<UCISPayload>) => {
    set((state) => {
      const now = new Date().toISOString();
      
      // If we're initializing the SAME analysis, don't wipe dimensions if payload is empty
      const isSameAnalysis = state.analysis?.id === payload.id && payload.id !== '';
      const incomingDimensions = payload.dimensions && Object.keys(payload.dimensions).length > 0
        ? payload.dimensions
        : (isSameAnalysis ? state.analysis?.dimensions : {});

      const newAnalysis: UCISPayload = {
        id: payload.id || state.analysis?.id || '',
        videoId: payload.videoId || state.analysis?.videoId || '',
        title: payload.title || state.analysis?.title || '',
        analysisAt: payload.analysisAt || state.analysis?.analysisAt || now,
        model: payload.model || state.analysis?.model || 'edge-stream',
        detectedPersona: payload.detectedPersona || state.analysis?.detectedPersona || 'analyst',
        dimensions: incomingDimensions || {},
        validation: payload.validation || state.analysis?.validation || {
          passed: false,
          errors: [],
          warnings: [],
        },
        streaming: payload.streaming || state.analysis?.streaming || {
          started: now,
          interrupted: false,
          dimensionsReceived: [],
        },
      };

      const hasDimensions = Object.keys(newAnalysis.dimensions).length > 0;

      return {
        analysis: newAnalysis,
        // If it has dimensions and an ID, it's likely a restoration or complete
        isStreaming: !payload.id || !hasDimensions,
        streamError: null,
        projection: computePersonaProjection(newAnalysis, state.activePersona),
      };
    });
  },

  /**
   * Add a dimension as it arrives from the Worker stream
   * Updates the raw analysis + recomputes projection
   */
  addDimension: (dimension: UCISDimension) => {
    // Validate dimension number
    if (!isValidDimensionNumber(dimension.number)) {
      console.warn(`[Nucleus] Invalid dimension number: ${dimension.number}`);
      return;
    }

    set((state) => {
      if (!state.analysis) return state;

      // Update raw analysis with new dimension
      const updatedAnalysis: UCISPayload = {
        ...state.analysis,
        dimensions: {
          ...state.analysis.dimensions,
          [dimension.number]: dimension,
        },
        streaming: {
          ...state.analysis.streaming,
          dimensionsReceived: [
            ...new Set([...state.analysis.streaming.dimensionsReceived, dimension.number]),
          ].sort((a, b) => a - b),
        },
      };

      return {
        analysis: updatedAnalysis,
        // CRITICAL: Recompute projection to reflect new dimension in current persona view
        projection: computePersonaProjection(updatedAnalysis, state.activePersona),
      };
    });
  },

  /**
   * Mark analysis as complete
   * Called when Worker finishes streaming all dimensions
   */
  completeAnalysis: () => {
    set((state) => {
      if (!state.analysis) return state;

      return {
        analysis: {
          ...state.analysis,
          completedAt: new Date().toISOString(),
          streaming: {
            ...state.analysis.streaming,
            ended: new Date().toISOString(),
          },
          validation: {
            ...state.analysis.validation,
            passed: true, // Mark as valid once streaming completes
          },
        },
        isStreaming: false,
      };
    });
  },

  /**
   * CRITICAL: Switch to a different persona (NO re-streaming)
   *
   * EDGE CASE HANDLING:
   * 1. User switches from Creator → Analyst while stream is active
   * 2. Analyst persona shows 8 dimensions (Creator showed only 5)
   * 3. Some of the new 8 may not have arrived yet → projection shows pending
   * 4. As stream continues, pending dimensions fill in → UI updates in real-time
   * 5. Full analysis (all 11) persisted when stream ends
   *
   * The key insight: `activePersona` is mutable, `analysis` is immutable.
   * Switching persona simply recomputes the VIEW without touching the data.
   */
  switchPersona: (persona: PersonaId) => {
    if (!isValidPersona(persona)) {
      console.warn(`[Nucleus] Invalid persona: ${persona}`);
      return;
    }

    set((state) => {
      const { analysis, activePersona } = state;

      // If already on this persona, no-op
      if (activePersona === persona) return state;

      // Recompute projection for new persona
      const newProjection = computePersonaProjection(analysis, persona);

      return {
        activePersona: persona,
        projection: newProjection,
      };
    });
  },

  /**
   * Mark streaming as errored
   * Keeps all received dimensions + allows user to view partial analysis
   */
  setStreamError: (error: string) => {
    set((state) => {
      if (!state.analysis) return state;

      return {
        analysis: {
          ...state.analysis,
          streaming: {
            ...state.analysis.streaming,
            interrupted: true,
            ended: new Date().toISOString(),
          },
          validation: {
            ...state.analysis.validation,
            passed: false,
            errors: [...(state.analysis.validation.errors || []), error],
          },
        },
        isStreaming: false,
        streamError: error,
      };
    });
  },

  /**
   * Reset all state (for new analysis)
   */
  reset: () => {
    set({
      analysis: null,
      activePersona: 'analyst',
      projection: null,
      isStreaming: false,
      streamError: null,
    });
  },

  // ============= HELPERS =============

  /**
   * Get a specific dimension by number
   */
  getDimension: (number: number) => {
    const state = get();
    if (!state.analysis || !isValidDimensionNumber(number)) return undefined;
    return state.analysis.dimensions[number];
  },

  /**
   * Check if all expected dimensions for current persona have arrived
   * Used by UI to know when persona is "fully loaded"
   */
  isPersonaComplete: () => {
    const state = get();
    const { analysis, activePersona } = state;
    if (!analysis) return false;

    const expectedDims = PERSONA_DIMENSIONS[activePersona];
    const received = analysis.streaming.dimensionsReceived;

    return expectedDims.every(num => received.includes(num));
  },

  /**
   * Export full analysis for persistence to DB
   * ALWAYS returns all 11 dimensions, regardless of active persona
   */
  getAnalysisForPersist: () => {
    const state = get();
    return state.analysis; // Return raw, unfiltered analysis
  },
}));

/**
 * Hook: Get the visible dimensions for the active persona
 * Useful for rendering dimension cards
 */
export const useVisibleDimensions = () => {
  const projection = useSynthesisNucleus((state) => state.projection);
  return projection?.visibleDimensions || [];
};

/**
 * Hook: Get streaming progress for UI (progress bar, loading states)
 */
export const useStreamingProgress = () => {
  const isStreaming = useSynthesisNucleus((state) => state.isStreaming);
  const progress = useSynthesisNucleus((state) => state.projection?.progress);
  return { isStreaming, progress };
};

/**
 * Hook: Get the current persona
 */
export const useActivePersona = () => {
  return useSynthesisNucleus((state) => state.activePersona);
};

/**
 * Hook: Get pending dimensions (still streaming) for current persona
 */
export const usePendingDimensions = () => {
  const pending = useSynthesisNucleus((state) => state.projection?.pendingDimensions);
  return pending || new Set();
};
