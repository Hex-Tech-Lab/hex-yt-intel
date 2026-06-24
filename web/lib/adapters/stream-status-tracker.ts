import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import { computePersonaProjection } from '@/lib/types/synthesis-nucleus';
import { type StreamAdapterOptions } from './synthesis-stream-adapter';

export class StreamStatusTracker {
  private synthStore = useSynthesisNucleus;
  private analysisStore = useAnalysisStore;

  constructor() {}

  public handleStatus(
    fragment: {
      type: 'status';
      stage: 'starting' | 'model' | 'fallback';
      videoId?: string;
      model?: string;
      from?: string;
      error?: string;
      rawError?: string;
    },
    options: StreamAdapterOptions,
    resetRawSink: () => void,
    rebuildMarkdown: (force?: boolean) => void
  ) {
    const store = this.analysisStore.getState();
    if (fragment.stage === 'starting') {
      store.logInfo(`Edge pipeline start for video ID: ${fragment.videoId}`);
    } else if (fragment.stage === 'model') {
      store.logInfo(`Contacting OpenRouter endpoint...`);
      store.logInfo(`Running model cascade node: ${fragment.model}`);
    } else if (fragment.stage === 'fallback') {
      // Reset rawSink buffer to prevent stale partial JSON from corrupting the fallback model run
      resetRawSink();

      // Reset ALL dimensions in the bundle upon fallback transition.
      // In bundle mode, only the bundle's dimensions are cleared; persona,
      // knowledgeGraph, classification, and monetizationVerdict are global
      // state shared across bundles and must NOT be cleared.
      const synthState = this.synthStore.getState();
      if (synthState.analysis) {
        const targetDims = options.dimensions;
        const updatedDimensions = { ...synthState.analysis.dimensions };
        let updatedReceived = [...synthState.analysis.streaming.dimensionsReceived];

        if (targetDims !== undefined && targetDims.length > 0) {
          for (const dim of targetDims) {
            delete updatedDimensions[dim];
          }
          updatedReceived = updatedReceived.filter(num => !targetDims.includes(num));
        } else {
          Object.keys(updatedDimensions).forEach(k => delete updatedDimensions[Number(k)]);
          updatedReceived = [];
        }

        this.synthStore.setState({
          analysis: {
            ...synthState.analysis,
            dimensions: updatedDimensions,
            streaming: {
              ...synthState.analysis.streaming,
              dimensionsReceived: updatedReceived,
            },
          },
          // In full fallback (targetDims undefined): clear ALL global state.
          // In bundle fallback (targetDims defined): preserve global state for
          // dimensions NOT in the bundle — only clear what the bundle owns.
          personaConfig: targetDims === undefined || targetDims.includes(1) ? null : synthState.personaConfig,
          knowledgeGraph: targetDims === undefined || targetDims.includes(8) ? null : synthState.knowledgeGraph,
          classification: targetDims === undefined || targetDims.includes(11) ? null : synthState.classification,
          monetizationVerdict: targetDims === undefined || targetDims.includes(11) ? null : synthState.monetizationVerdict,
          projection: computePersonaProjection({
            ...synthState.analysis,
            dimensions: updatedDimensions,
            streaming: {
              ...synthState.analysis.streaming,
              dimensionsReceived: updatedReceived,
            },
          }, synthState.activePersona),
          streamError: null,
        });

        // Trigger rebuilding of display markdown from the remaining dimensions
        rebuildMarkdown(true);
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
  }

  public handleComplete(
    fragment: {
      type: 'complete' | 'done';
      model: string;
      valid: boolean;
      videoId: string;
      analysisId: string;
    },
    options: StreamAdapterOptions,
    onCompleteCallback?: () => void
  ) {
    const store = this.synthStore.getState();
    const analysisStore = this.analysisStore.getState();
    
    if (!options.isPartialStream) {
      store.completeAnalysis();
      if (fragment.valid) {
        analysisStore.logOk(`Synthesis verification complete. Structure check passed.`);
      } else {
        analysisStore.logError(`Content verification warning: output did not pass all ${TOTAL_DIMENSIONS}-dimension checks.`);
      }
    }

    if (onCompleteCallback) {
      onCompleteCallback();
    }

    console.log('[Adapter] Stream complete:', {
      model: fragment.model,
      valid: fragment.valid,
      analysisId: fragment.analysisId,
    });
  }

  public handleError(
    fragment: {
      type: 'error';
      error: string;
      code?: string;
    },
    onErrorCallback?: (error: string) => void
  ) {
    const store = this.synthStore.getState();
    store.setStreamError(fragment.error);

    this.analysisStore.getState().logError(`Edge stream error: ${fragment.error}`);

    if (onErrorCallback) {
      onErrorCallback(fragment.error);
    }

    console.error('[Adapter] Stream error:', fragment);
  }
}
