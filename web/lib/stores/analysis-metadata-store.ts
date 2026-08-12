import { create } from 'zustand';
import { useAnalysisStateStore } from './analysis-state-store';
import { useAnalysisStreamingStore } from './analysis-streaming-store';
import {
  type PersonaId,
  type PersonaConfigV2,
  type KnowledgeGraphV2,
  type ClassificationData,
  type MonetizationVerdict,
  type RestoreAnalysisPayload,
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
  rawAnalysisPayload: RestoreAnalysisPayload | null;
  /** The analysisId `rawAnalysisPayload` belongs to. Consumers must check
   *  this matches the analysisId they're rendering before trusting the
   *  payload -- a global unscoped payload can't tell two analyses apart
   *  (Cubic review, PR #214). */
  rawAnalysisPayloadId: string | null;
  switchPersona: (persona: PersonaId) => void;
  setPersonaConfig: (config: PersonaConfigV2) => void;
  setKnowledgeGraph: (kg: KnowledgeGraphV2) => void;
  setClassification: (data: ClassificationData) => void;
  setMonetizationVerdict: (verdict: MonetizationVerdict) => void;
  setRawAnalysisPayload: (payload: RestoreAnalysisPayload | null, analysisId: string | null) => void;
  isPersonaComplete: () => boolean;
  reset: () => void;
}

export const useAnalysisMetadataStore = create<AnalysisMetadataStore>((set, get) => ({
  // Default persona view: LLM Council Round 1 (2026-08-12) ruled persona is a
  // marketing/design lens, not a user-facing runtime picker. Defaults to the
  // apex 'creator' view (all 11 dimensions) rather than a guessed persona.
  // Owner of this default: product owner. Revisit when Round 2 (dimension
  // remapping) concludes -- see docs/private/council/2026-08-12_1500_v1_round1_full_transcript.md
  activePersona: 'creator',
  personaConfig: null,
  knowledgeGraph: null,
  classification: null,
  monetizationVerdict: null,
  rawAnalysisPayload: null,
  rawAnalysisPayloadId: null,

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

  setRawAnalysisPayload: (payload: RestoreAnalysisPayload | null, analysisId: string | null) => {
    // Deep equality is overkill here (this is a raw API payload object, not
    // a small typed shape like the sibling setters above) -- reference
    // equality is cheap and still catches the real redundant-call case,
    // e.g. the same data.analysis_payload object flowing through both
    // initializeAnalysis and a fetch-effect resolution.
    const current = get();
    if (current.rawAnalysisPayload === payload && current.rawAnalysisPayloadId === analysisId) return;
    set({ rawAnalysisPayload: payload, rawAnalysisPayloadId: analysisId });
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
      activePersona: 'creator',
      personaConfig: null,
      knowledgeGraph: null,
      classification: null,
      monetizationVerdict: null,
      rawAnalysisPayload: null,
      rawAnalysisPayloadId: null,
    });
  },
}));
