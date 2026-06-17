import { create } from 'zustand';
import { useAnalysisStateStore } from './analysis-state-store';
import { useAnalysisDimensionsStore } from './analysis-dimensions-store';
import { useAnalysisMetadataStore } from './analysis-metadata-store';
import { useAnalysisStreamingStore } from './analysis-streaming-store';
import {
  type SynthesisNucleusState,
  type UCISPayload,
  type UCISDimension,
  type PersonaId,
  type PersonaConfigV2,
  type KnowledgeGraphV2,
  type ClassificationData,
  type MonetizationVerdict,
  computePersonaProjection,
} from '@/lib/types/synthesis-nucleus';

let syncInit = false;

function syncUnifiedStore(set: (partial: Partial<SynthesisNucleusState>) => void) {
  if (!syncInit) {
    syncInit = true;
    useAnalysisStateStore.subscribe(() => {
      const as = useAnalysisStateStore.getState();
      const ms = useAnalysisMetadataStore.getState();
      const ss = useAnalysisStreamingStore.getState();
      set({
        analysis: as.analysis,
        isStreaming: as.isStreaming,
        activePersona: ms.activePersona,
        personaConfig: ms.personaConfig,
        knowledgeGraph: ms.knowledgeGraph,
        classification: ms.classification,
        monetizationVerdict: ms.monetizationVerdict,
        streamError: ss.streamError,
        projection: ss.projection,
      });
    });
    useAnalysisMetadataStore.subscribe(() => {
      const as = useAnalysisStateStore.getState();
      const ms = useAnalysisMetadataStore.getState();
      const ss = useAnalysisStreamingStore.getState();
      set({
        analysis: as.analysis,
        isStreaming: as.isStreaming,
        activePersona: ms.activePersona,
        personaConfig: ms.personaConfig,
        knowledgeGraph: ms.knowledgeGraph,
        classification: ms.classification,
        monetizationVerdict: ms.monetizationVerdict,
        streamError: ss.streamError,
        projection: ss.projection,
      });
    });
    useAnalysisStreamingStore.subscribe(() => {
      const as = useAnalysisStateStore.getState();
      const ss = useAnalysisStreamingStore.getState();
      set({
        analysis: as.analysis,
        isStreaming: as.isStreaming,
        streamError: ss.streamError,
        projection: ss.projection,
      });
    });
  }
}

export const useSynthesisNucleus = create<SynthesisNucleusState>((set) => {
  const as = useAnalysisStateStore.getState();
  const ms = useAnalysisMetadataStore.getState();
  const ss = useAnalysisStreamingStore.getState();

  syncUnifiedStore(set);

  return {
    analysis: as.analysis,
    personaConfig: ms.personaConfig,
    knowledgeGraph: ms.knowledgeGraph,
    classification: ms.classification,
    monetizationVerdict: ms.monetizationVerdict,
    activePersona: ms.activePersona,
    projection: ss.projection,
    isStreaming: as.isStreaming,
    streamError: ss.streamError,

    initializeAnalysis: (payload: Partial<UCISPayload>) => {
      useAnalysisStateStore.getState().initializeAnalysis(payload);
      const syncedAnalysis = useAnalysisStateStore.getState().analysis;
      const activePersona = useAnalysisMetadataStore.getState().activePersona;
      const projection = computePersonaProjection(syncedAnalysis, activePersona);
      useAnalysisStreamingStore.getState().setProjection(projection);
    },

    addDimension: (dimension: UCISDimension) => {
      useAnalysisDimensionsStore.getState().addDimension(dimension);
    },

    completeAnalysis: () => {
      useAnalysisStateStore.getState().completeAnalysis();
    },

    switchPersona: (persona: PersonaId) => {
      useAnalysisMetadataStore.getState().switchPersona(persona);
    },

    setStreamError: (error: string) => {
      useAnalysisStreamingStore.getState().setStreamError(error);
    },

    reset: () => {
      useAnalysisStateStore.getState().reset();
      useAnalysisDimensionsStore.getState().reset();
      useAnalysisMetadataStore.getState().reset();
      useAnalysisStreamingStore.getState().reset();
    },

    setPersonaConfig: (config: PersonaConfigV2) => {
      useAnalysisMetadataStore.getState().setPersonaConfig(config);
    },

    setKnowledgeGraph: (kg: KnowledgeGraphV2) => {
      useAnalysisMetadataStore.getState().setKnowledgeGraph(kg);
    },

    setClassification: (data: ClassificationData) => {
      useAnalysisMetadataStore.getState().setClassification(data);
    },

    setMonetizationVerdict: (verdict: MonetizationVerdict) => {
      useAnalysisMetadataStore.getState().setMonetizationVerdict(verdict);
    },

    getDimension: (number: number) => {
      return useAnalysisDimensionsStore.getState().getDimension(number);
    },

    isPersonaComplete: () => {
      return useAnalysisMetadataStore.getState().isPersonaComplete();
    },

    getAnalysisForPersist: () => {
      return useAnalysisStateStore.getState().getAnalysisForPersist();
    },
  };
});

export const useVisibleDimensions = () => {
  const projection = useSynthesisNucleus((state) => state.projection);
  return projection?.visibleDimensions || [];
};

export const useStreamingProgress = () => {
  const isStreaming = useSynthesisNucleus((state) => state.isStreaming);
  const progress = useSynthesisNucleus((state) => state.projection?.progress);
  return { isStreaming, progress };
};

export const useActivePersona = () => {
  return useSynthesisNucleus((state) => state.activePersona);
};

export const usePendingDimensions = () => {
  const pending = useSynthesisNucleus((state) => state.projection?.pendingDimensions);
  return pending || new Set();
};
