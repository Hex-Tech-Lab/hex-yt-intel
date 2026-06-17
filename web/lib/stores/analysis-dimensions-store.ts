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

    const analysisState = useAnalysisStateStore.getState();
    if (!analysisState.analysis) return;

    const { analysis } = analysisState;
    const updatedAnalysis = {
      ...analysis,
      dimensions: {
        ...analysis.dimensions,
        [dimension.number]: dimension,
      },
      streaming: {
        ...analysis.streaming,
        dimensionsReceived: [
          ...new Set([...analysis.streaming.dimensionsReceived, dimension.number]),
        ].sort((a, b) => a - b),
      },
    };

    useAnalysisStateStore.setState({ analysis: updatedAnalysis });

    const activePersona = useAnalysisMetadataStore.getState().activePersona;
    const projection = computePersonaProjection(updatedAnalysis, activePersona);
    useAnalysisStreamingStore.getState().setProjection(projection);
  },

  getDimension: (number: number) => {
    if (!isValidDimensionNumber(number)) return undefined;
    const analysisState = useAnalysisStateStore.getState();
    return analysisState.analysis?.dimensions[number];
  },

  reset: () => {},
}));
