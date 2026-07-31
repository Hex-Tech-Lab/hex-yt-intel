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

function readSubStores() {
  const as = useAnalysisStateStore.getState();
  const ms = useAnalysisMetadataStore.getState();
  const ss = useAnalysisStreamingStore.getState();
  const hasAnyDimension = Boolean(as.analysis && Object.keys(as.analysis.dimensions).length > 0);
  const projection = hasAnyDimension
    ? computePersonaProjection(as.analysis, ms.activePersona)
    : null;
  return {
    analysis: as.analysis,
    isStreaming: as.isStreaming,
    activePersona: ms.activePersona,
    personaConfig: ms.personaConfig,
    knowledgeGraph: ms.knowledgeGraph,
    classification: ms.classification,
    monetizationVerdict: ms.monetizationVerdict,
    streamError: ss.streamError,
    projection,
  };
}

export const useSynthesisNucleus = create<SynthesisNucleusState>((set) => {
  useAnalysisStateStore.subscribe(() => set(readSubStores()));
  useAnalysisMetadataStore.subscribe(() => set(readSubStores()));
  useAnalysisStreamingStore.subscribe(() => set(readSubStores()));

  return {
    ...readSubStores(),

    initializeAnalysis: (payload: Partial<UCISPayload> & { analysisPayload?: any }) => {
      // Switching to a genuinely different analysis (e.g. selecting a
      // different video from History) must clear the PREVIOUS analysis's
      // persona/knowledgeGraph/classification/monetizationVerdict before
      // conditionally repopulating below -- otherwise a field the new
      // payload doesn't carry (e.g. no knowledgeGraph for this video) just
      // leaves the old video's stale value sitting here, displayed as if it
      // belonged to the new video. Real bug, live-reported 2026-08-01:
      // switching from a Japanese to a German video via History left the
      // graphs/classification showing the Japanese analysis's data even
      // though the header/title/dimensions updated correctly (those already
      // had their own fresh-id reset in analysis-state-store.ts).
      const existingId = useAnalysisStateStore.getState().analysis?.id;
      const isSwitchingAnalysis = Boolean(payload.id && existingId && payload.id !== existingId);
      if (isSwitchingAnalysis) {
        useAnalysisMetadataStore.getState().reset();
      }

      useAnalysisStateStore.getState().initializeAnalysis(payload);
      useAnalysisStreamingStore.getState().clearStreamError();
      const ap = payload.analysisPayload;
      if (ap) {
        if (ap.persona) useAnalysisMetadataStore.getState().setPersonaConfig(ap.persona);
        if (ap.knowledgeGraph) useAnalysisMetadataStore.getState().setKnowledgeGraph(ap.knowledgeGraph);
        if (ap.classification) useAnalysisMetadataStore.getState().setClassification(ap.classification);
        if (ap.monetizationVerdict) useAnalysisMetadataStore.getState().setMonetizationVerdict(ap.monetizationVerdict);
      }
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
