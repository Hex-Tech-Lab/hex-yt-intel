import { create } from 'zustand';
import type { UCISPayload } from '@/lib/types/synthesis-nucleus';

export interface AnalysisStateStore {
  analysis: UCISPayload | null;
  isStreaming: boolean;
  initializeAnalysis: (payload: Partial<UCISPayload>) => void;
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
        isStreaming: !payload.id || !hasDimensions,
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
