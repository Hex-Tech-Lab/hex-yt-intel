import { create } from 'zustand';
import { useAnalysisStateStore } from './analysis-state-store';
import { useAnalysisMetadataStore } from './analysis-metadata-store';
import {
  type PersonaProjection,
  computePersonaProjection,
} from '@/lib/types/synthesis-nucleus';

export interface AnalysisStreamingStore {
  streamError: string | null;
  projection: PersonaProjection | null;
  setStreamError: (error: string) => void;
  setProjection: (projection: PersonaProjection | null) => void;
  reset: () => void;
}

export const useAnalysisStreamingStore = create<AnalysisStreamingStore>((set) => ({
  streamError: null,
  projection: null,

  setStreamError: (error: string) => {
    const analysisState = useAnalysisStateStore.getState();
    if (!analysisState.analysis) return;

    const updatedAnalysis = {
      ...analysisState.analysis,
      streaming: {
        ...analysisState.analysis.streaming,
        interrupted: true,
        ended: new Date().toISOString(),
      },
      validation: {
        ...analysisState.analysis.validation,
        passed: false,
        errors: [...(analysisState.analysis.validation.errors || []), error],
      },
    };

    useAnalysisStateStore.setState({ analysis: updatedAnalysis, isStreaming: false });

    const activePersona = useAnalysisMetadataStore.getState().activePersona;
    const projection = computePersonaProjection(updatedAnalysis, activePersona);
    set({
      streamError: error,
      projection,
    });
  },

  setProjection: (projection: PersonaProjection | null) => {
    set({ projection });
  },

  reset: () => {
    set({ streamError: null, projection: null });
  },
}));
