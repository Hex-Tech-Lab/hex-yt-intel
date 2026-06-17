import { create } from 'zustand';
import type { UCISPayload, UCISDimension } from '@/lib/types/synthesis-nucleus';

export interface AnalysisStateStore {
  analysis: UCISPayload | null;
  isStreaming: boolean;
  initializeAnalysis: (payload: Partial<UCISPayload>) => void;
  addDimension: (dimension: UCISDimension) => void;
  completeAnalysis: () => void;
  reset: () => void;
  getAnalysisForPersist: () => UCISPayload | null;
}

function mergePayload(base: UCISPayload, patch: Partial<UCISPayload>): UCISPayload {
  return {
    ...base,
    id: patch.id || base.id,
    videoId: patch.videoId || base.videoId,
    title: patch.title || base.title,
    analysisAt: patch.analysisAt || base.analysisAt,
    model: patch.model || base.model,
    detectedPersona: patch.detectedPersona || base.detectedPersona,
    dimensions: patch.dimensions
      ? { ...base.dimensions, ...patch.dimensions }
      : base.dimensions,
    validation: patch.validation || base.validation,
    streaming: patch.streaming || base.streaming,
  };
}

function newPayload(payload: Partial<UCISPayload>, now: string): UCISPayload {
  return {
    id: payload.id || '',
    videoId: payload.videoId || '',
    title: payload.title || '',
    analysisAt: payload.analysisAt || now,
    model: payload.model || 'edge-stream',
    detectedPersona: payload.detectedPersona || 'analyst',
    dimensions: payload.dimensions || {},
    validation: payload.validation || { passed: false, errors: [], warnings: [] },
    streaming: payload.streaming || { started: now, interrupted: false, dimensionsReceived: [] },
  };
}

export const useAnalysisStateStore = create<AnalysisStateStore>((set, get) => ({
  analysis: null,
  isStreaming: false,

  initializeAnalysis: (payload: Partial<UCISPayload>) => {
    set((state) => {
      const now = new Date().toISOString();
      const existing = state.analysis;
      const hasFreshId = !!(payload.id && payload.id.length > 0);
      const hasDimensions = !!(payload.dimensions && Object.keys(payload.dimensions).length > 0);

      if (!existing) return { analysis: newPayload(payload, now), isStreaming: !hasDimensions };
      if (hasFreshId && hasDimensions) {
        const restored = mergePayload(existing, payload);
        restored.dimensions = payload.dimensions!;
        return { analysis: restored, isStreaming: false };
      }
      return { analysis: mergePayload(existing, payload), isStreaming: true };
    });
  },

  addDimension: (dimension: UCISDimension) => {
    set((state) => {
      if (!state.analysis) return state;
      return {
        analysis: {
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
        },
      };
    });
  },

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
            passed: true,
          },
        },
        isStreaming: false,
      };
    });
  },

  reset: () => {
    set({ analysis: null, isStreaming: false });
  },

  getAnalysisForPersist: () => {
    return get().analysis;
  },
}));
