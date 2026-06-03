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
import type { UCISDimension } from '@/lib/types/synthesis-nucleus';

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
        this.handleComplete(fragment);
        break;
      case 'error':
        this.handleError(fragment);
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
  }) {
    // Status messages are lifecycle events; log them for debugging
    console.debug('[Adapter] Status update:', {
      stage: fragment.stage,
      model: fragment.model || fragment.from,
      error: fragment.error,
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
    store.appendTerminalLine(fragment.content);
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
    type: 'complete';
    model: string;
    valid: boolean;
    videoId: string;
    analysisId: string;
  }) {
    const store = this.synthStore.getState();
    store.completeAnalysis();

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

    // Notify error
    if (this.options.onError) {
      this.options.onError(fragment.error);
    }

    console.error('[Adapter] Stream error:', fragment);
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
