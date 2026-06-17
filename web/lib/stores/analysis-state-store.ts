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

export const useAnalysisStateStore = create<AnalysisStateStore>((set, get) => ({
  analysis: null,
  isStreaming: false,

  initializeAnalysis: (payload: Partial<UCISPayload>) => {
    set((state) => {
      const now = new Date().toISOString();
      const existing = state.analysis;
      const hasFreshId = payload.id && payload.id.length > 0;
      const hasDimensions = payload.dimensions && Object.keys(payload.dimensions).length > 0;

      // Case 1: New analysis — no existing state, full initialization
      if (!existing) {
        return {
          analysis: {
            id: payload.id || '',
            videoId: payload.videoId || '',
            title: payload.title || '',
            analysisAt: payload.analysisAt || now,
            model: payload.model || 'edge-stream',
            detectedPersona: payload.detectedPersona || 'analyst',
            dimensions: payload.dimensions || {},
            validation: payload.validation || { passed: false, errors: [], warnings: [] },
            streaming: payload.streaming || {
              started: now,
              interrupted: false,
              dimensionsReceived: [],
            },
          },
          isStreaming: !hasDimensions,
        };
      }

      // Case 2: Restore — existing analysis + complete payload with id and dimensions
      if (hasFreshId && hasDimensions) {
        return {
          analysis: {
            ...existing,
            id: payload.id!,
            videoId: payload.videoId || existing.videoId,
            title: payload.title || existing.title,
            analysisAt: payload.analysisAt || existing.analysisAt,
            model: payload.model || existing.model,
            detectedPersona: payload.detectedPersona || existing.detectedPersona,
            dimensions: payload.dimensions!,
            validation: payload.validation || existing.validation,
            streaming: payload.streaming || existing.streaming,
          },
          isStreaming: false,
        };
      }

      // Case 3: Partial payload — streaming update, merge into existing
      return {
        analysis: {
          ...existing,
          id: payload.id || existing.id,
          videoId: payload.videoId || existing.videoId,
          title: payload.title || existing.title,
          analysisAt: payload.analysisAt || existing.analysisAt,
          model: payload.model || existing.model,
          detectedPersona: payload.detectedPersona || existing.detectedPersona,
          dimensions: hasDimensions
            ? { ...existing.dimensions, ...payload.dimensions }
            : existing.dimensions,
          validation: payload.validation || existing.validation,
          streaming: payload.streaming || existing.streaming,
        },
        isStreaming: true,
      };
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
