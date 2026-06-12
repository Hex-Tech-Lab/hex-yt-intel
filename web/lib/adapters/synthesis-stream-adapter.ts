/**
 * Synthesis Stream Adapter
 *
 * HEXAGONAL ARCHITECTURE:
 * - INPUT (Edge): SSE stream from Cloudflare Worker
 * - ADAPTER: Parse JSON fragments + validate + map to domain entities
 * - OUTPUT (Domain): Feed into Zustand store (SynthesisNucleus)
 *
 * Handles:
 * - JSON parsing with error recovery
 * - Zod validation + logging
 * - Dimension accumulation
 * - Mid-stream error handling
 * - Graceful degradation
 */

import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { validateFragment, validateDimension } from '@/lib/validators/synthesis';
import {
  type UCISDimension,
  type PersonaConfigV2,
  type KnowledgeGraphV2,
  type ClassificationData,
  computePersonaProjection,
} from '@/lib/types/synthesis-nucleus';

export interface StreamAdapterOptions {
  onError?: (error: string) => void;
  onComplete?: () => void;
  onProgress?: (received: number, expected: number) => void;
}

export class SynthesisStreamAdapter {
  private synthStore = useSynthesisNucleus;
  private analysisStore = useAnalysisStore;
  private options: StreamAdapterOptions;

  constructor(options: StreamAdapterOptions = {}) {
    this.options = options;
  }

  /**
   * Process a line from the SSE stream
   * Lines are delimited by newlines and contain JSON
   */
  processLine(line: string) {
    if (!line.trim()) return;

    // Parse JSON
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch (err) {
      console.error('[Adapter] JSON parse failed:', err, 'line:', line.slice(0, 200));
      return;
    }

    // Validate against union type
    const validation = validateFragment(data);
    if (!validation.success) {
      console.error('[Adapter] Fragment validation failed, skipping:', {
        errors: validation.error.flatten(),
        data: JSON.stringify(data).slice(0, 200),
      });
      return;
    }

    const fragment = validation.data;

    // Route to handler
    switch (fragment.type) {
      case 'status':
        this.handleStatus(fragment);
        break;
      case 'delta':
        this.handleDelta(fragment);
        break;
      case 'dimension':
        this.handleDimension(fragment);
        break;
      case 'metadata':
        this.handleMetadata(fragment);
        break;
      case 'complete':
      case 'done':
        this.handleComplete(fragment);
        break;
      case 'error':
        this.handleError(fragment);
        break;
      // ADR 006: New v2.0 fragment types
      case 'persona':
        this.handlePersona(fragment);
        break;
      case 'kg':
        this.handleKG(fragment);
        break;
      case 'classification':
        this.handleClassification(fragment);
        break;
    }
  }

  /**
   * Handle a status fragment: lifecycle updates (starting, model, fallback)
   */
  private handleStatus(fragment: {
    type: 'status';
    stage: 'starting' | 'model' | 'fallback';
    videoId?: string;
    model?: string;
    from?: string;
    error?: string;
    rawError?: string;
  }) {
    const store = this.analysisStore.getState();
    if (fragment.stage === 'starting') {
      store.logInfo(`Edge pipeline start for video ID: ${fragment.videoId}`);
    } else if (fragment.stage === 'model') {
      store.logInfo(`Contacting OpenRouter endpoint...`);
      store.logInfo(`Running model cascade node: ${fragment.model}`);
    } else if (fragment.stage === 'fallback') {
      // Clear any partial text written by the failed model so the next model starts fresh
      store.setAnalysis(store.analysis ? { ...store.analysis, analysis_markdown: '' } : null);

      // Fully reset the synthesis projection state (dimensions, persona, etc.) upon a fallback transition,
      // keeping the metadata of the current analysis intact.
      const synthState = this.synthStore.getState();
      if (synthState.analysis) {
        this.synthStore.setState({
          analysis: {
            ...synthState.analysis,
            dimensions: {},
            streaming: {
              ...synthState.analysis.streaming,
              dimensionsReceived: [],
            },
          },
          personaConfig: null,
          knowledgeGraph: null,
          classification: null,
          projection: computePersonaProjection({
            ...synthState.analysis,
            dimensions: {},
            streaming: {
              ...synthState.analysis.streaming,
              dimensionsReceived: [],
            },
          }, synthState.activePersona),
          streamError: null,
        });
      }

      const code = fragment.error || '';
      let msg = 'Optimizing pipeline routing...';
      if (code === 'ERR_MODEL_REFUSAL') {
        msg = 'Model response validation failed. Re-routing analysis...';
      } else if (code === 'ERR_MODEL_OVERLOAD') {
        msg = 'Provider capacity limit reached. Re-routing to alternate provider...';
      } else if (code === 'ERR_CONNECTION_TIMEOUT') {
        msg = 'Connection response delayed. Adjusting backup cascade path...';
      } else if (code === 'ERR_MONTHLY_QUOTA_EXHAUSTED') {
        msg = 'Model tier capacity overdrawn. Transitioning route...';
      } else if (code === 'ERR_INTERNAL_PROVIDER_FAULT') {
        msg = 'Cascade path fault detected. Switching node...';
      }

      store.logError(msg);
      if (fragment.rawError) {
        store.logError(`[RCA] Raw OpenRouter response: ${fragment.rawError}`);
      }
      store.logInfo(`Attempting automated fallback routing...`);
    }

    // Status messages are lifecycle events; log them for debugging
    console.debug('[Adapter] Status update:', {
      stage: fragment.stage,
      model: fragment.model || fragment.from,
      error: fragment.error,
      rawError: fragment.rawError,
    });
  }

  /**
   * Handle a delta fragment: raw LLM text chunk for terminal display
   */
  private handleDelta(fragment: {
    type: 'delta';
    content: string;
  }) {
    const store = this.analysisStore.getState();
    store.appendMarkdown(fragment.content);
    console.debug('[Adapter] Delta received:', fragment.content.slice(0, 100));
  }

  /**
   * Handle a dimension fragment: convert to domain entity + add to store
   */
  private handleDimension(fragment: {
    type: 'dimension';
    dimension: number;
    name: string;
    content: string;
    metadata?: any;
  }) {
    // Create domain entity
    const dimension: UCISDimension = {
      number: fragment.dimension,
      name: fragment.name,
      content: fragment.content,
      metadata: fragment.metadata,
    };

    // Validate domain entity
    const entityValidation = validateDimension(dimension);
    if (!entityValidation.success) return;

    // Feed into store
    const store = this.synthStore.getState();
    store.addDimension(entityValidation.data);

    this.analysisStore.getState().logOk(`Synthesized Dimension ${fragment.dimension}: ${fragment.name}`);

    // Notify progress
    if (this.options.onProgress) {
      const state = this.synthStore.getState();
      const proj = state.projection;
      if (proj) {
        this.options.onProgress(proj.progress.received, proj.progress.expected);
      }
    }
  }

  /**
   * Handle metadata fragment: update analysis metadata
   */
  private handleMetadata(fragment: {
    type: 'metadata';
    model?: string;
    persona?: string;
  }) {
    // Metadata could be used to update the analysis record later
    // For now, just log for debugging
    console.debug('[Adapter] Metadata:', fragment);
  }

  /**
   * Handle completion fragment: mark stream as complete
   */
  private handleComplete(fragment: {
    type: 'complete' | 'done';
    model: string;
    valid: boolean;
    videoId: string;
    analysisId: string;
  }) {
    const store = this.synthStore.getState();
    store.completeAnalysis();

    const analysisStore = this.analysisStore.getState();
    if (fragment.valid) {
      analysisStore.logOk(`Synthesis verification complete. Structure check passed.`);
    } else {
      analysisStore.logError(`Content verification warning: output did not pass all 11-dimension checks.`);
    }

    // Notify completion
    if (this.options.onComplete) {
      this.options.onComplete();
    }

    console.log('[Adapter] Stream complete:', {
      model: fragment.model,
      valid: fragment.valid,
      analysisId: fragment.analysisId,
    });
  }

  /**
   * Handle error fragment: set error state + keep partial analysis
   */
  private handleError(fragment: {
    type: 'error';
    error: string;
    code?: string;
  }) {
    const store = this.synthStore.getState();
    store.setStreamError(fragment.error);

    this.analysisStore.getState().logError(`Edge stream error: ${fragment.error}`);

    // Notify error
    if (this.options.onError) {
      this.options.onError(fragment.error);
    }

    console.error('[Adapter] Stream error:', fragment);
  }

  // ADR 006: v2.0 Fragment Handlers

  private handlePersona(fragment: { type: 'persona'; config: PersonaConfigV2 }) {
    const store = this.synthStore.getState();
    store.setPersonaConfig(fragment.config);
    this.analysisStore.getState().logOk(`Resolved persona schema: ${fragment.config.primary.label}`);
  }

  private handleKG(fragment: { type: 'kg'; nodes: KnowledgeGraphV2['nodes']; edges: KnowledgeGraphV2['edges']; rootId: string | null }) {
    const store = this.synthStore.getState();
    store.setKnowledgeGraph({
      nodes: fragment.nodes,
      edges: fragment.edges,
      rootId: fragment.rootId,
    });
    this.analysisStore.getState().logOk(`Structured Knowledge Graph constructed (${fragment.nodes.length} nodes, ${fragment.edges.length} edges)`);
  }

  private handleClassification(fragment: { type: 'classification'; data: ClassificationData }) {
    const store = this.synthStore.getState();
    store.setClassification(fragment.data);
    this.analysisStore.getState().logOk(`Actionable classification: ${fragment.data.recommendation}`);
  }

  /**
   * Reset adapter state for new stream
   */
  reset() {
    this.synthStore.getState().reset();
    this.analysisStore.getState().clearTerminal();
  }
}

/**
 * Hook to connect SSE stream to Synthesis Nucleus
 * Usage:
 *   const adapter = useStreamAdapter();
 *   fetch('/api/analyses/stream').then(res => {
 *     const reader = res.body?.getReader();
 *     // ... read lines from stream ...
 *     adapter.processLine(line);
 *   });
 */
export function useStreamAdapter(options?: StreamAdapterOptions) {
  return new SynthesisStreamAdapter(options);
}
