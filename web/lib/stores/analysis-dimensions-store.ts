import { create } from 'zustand';
import { useAnalysisStateStore } from './analysis-state-store';
import { useAnalysisStreamingStore } from './analysis-streaming-store';
import { useAnalysisMetadataStore } from './analysis-metadata-store';
import {
  type UCISDimension,
  computePersonaProjection,
  isValidDimensionNumber,
} from '@/lib/types/synthesis-nucleus';

export interface AnalysisDimensionsStore {
  addDimension: (dimension: UCISDimension) => void;
  getDimension: (number: number) => UCISDimension | undefined;
  reset: () => void;
}

export const useAnalysisDimensionsStore = create<AnalysisDimensionsStore>(() => ({
  addDimension: (dimension: UCISDimension) => {
    if (!isValidDimensionNumber(dimension.number)) {
      console.warn(`[Dimensions] Invalid dimension number: ${dimension.number}`);
      return;
    }

    useAnalysisStateStore.getState().addDimension(dimension);

    const analysis = useAnalysisStateStore.getState().analysis;
    if (!analysis) return;
    const activePersona = useAnalysisMetadataStore.getState().activePersona;
    const projection = computePersonaProjection(analysis, activePersona);
    useAnalysisStreamingStore.getState().setProjection(projection);
  },

  getDimension: (number: number) => {
    if (!isValidDimensionNumber(number)) return undefined;
    const analysisState = useAnalysisStateStore.getState();
    return analysisState.analysis?.dimensions[number];
  },

  reset: () => {
    useAnalysisStateStore.setState((state) => {
      if (!state.analysis) return state;
      return {
        analysis: {
          ...state.analysis,
          dimensions: {},
          streaming: {
            ...state.analysis.streaming,
            dimensionsReceived: [],
          },
        },
      };
    });
  },
}));
