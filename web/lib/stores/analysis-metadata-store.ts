import { create } from 'zustand';
import { useAnalysisStateStore } from './analysis-state-store';
import { useAnalysisStreamingStore } from './analysis-streaming-store';
import {
  type PersonaId,
  type PersonaConfigV2,
  type KnowledgeGraphV2,
  type ClassificationData,
  type MonetizationVerdict,
  computePersonaProjection,
  isValidPersona,
  PERSONA_DIMENSIONS,
} from '@/lib/types/synthesis-nucleus';

export interface AnalysisMetadataStore {
  activePersona: PersonaId;
  personaConfig: PersonaConfigV2 | null;
  knowledgeGraph: KnowledgeGraphV2 | null;
  classification: ClassificationData | null;
  monetizationVerdict: MonetizationVerdict | null;
  switchPersona: (persona: PersonaId) => void;
  setPersonaConfig: (config: PersonaConfigV2) => void;
  setKnowledgeGraph: (kg: KnowledgeGraphV2) => void;
  setClassification: (data: ClassificationData) => void;
  setMonetizationVerdict: (verdict: MonetizationVerdict) => void;
  isPersonaComplete: () => boolean;
  reset: () => void;
}

export const useAnalysisMetadataStore = create<AnalysisMetadataStore>((set, get) => ({
  activePersona: 'consultant',
  personaConfig: null,
  knowledgeGraph: null,
  classification: null,
  monetizationVerdict: null,

  switchPersona: (persona: PersonaId) => {
    if (!isValidPersona(persona)) {
      console.warn(`[Metadata] Invalid persona: ${persona}`);
      return;
    }

    const { activePersona } = get();
    if (activePersona === persona) return;

    set({ activePersona: persona });

    const analysis = useAnalysisStateStore.getState().analysis;
    const projection = computePersonaProjection(analysis, persona);
    useAnalysisStreamingStore.getState().setProjection(projection);
  },

  setPersonaConfig: (config: PersonaConfigV2) => {
    if (get().personaConfig?.primary?.id === config.primary?.id) return;
    set({ personaConfig: config });
    console.debug('[Metadata] Persona config received:', config.primary.id);
  },

  setKnowledgeGraph: (kg: KnowledgeGraphV2) => {
    const current = get().knowledgeGraph;
    if (current?.nodes?.length === kg.nodes?.length && current?.edges?.length === kg.edges?.length) return;
    set({ knowledgeGraph: kg });
    console.debug('[Metadata] Knowledge Graph received:', {
      nodes: kg.nodes.length,
      edges: kg.edges.length,
    });
  },

  setClassification: (data: ClassificationData) => {
    if (get().classification?.recommendation === data.recommendation) return;
    set({ classification: data });
    console.debug('[Metadata] Classification received:', data.recommendation);
  },

  setMonetizationVerdict: (verdict: MonetizationVerdict) => {
    if (get().monetizationVerdict === verdict) return;
    set({ monetizationVerdict: verdict });
    console.debug('[Metadata] Monetization verdict received');
  },

  isPersonaComplete: () => {
    const { activePersona } = get();
    const analysis = useAnalysisStateStore.getState().analysis;
    if (!analysis) return false;

    const expectedDims = PERSONA_DIMENSIONS[activePersona];
    const received = analysis.streaming.dimensionsReceived;

    return expectedDims.every(num => received.includes(num));
  },

  reset: () => {
    set({
      activePersona: 'consultant',
      personaConfig: null,
      knowledgeGraph: null,
      classification: null,
      monetizationVerdict: null,
    });
  },
}));
