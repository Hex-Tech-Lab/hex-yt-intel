/**
 * Synthesis Stream Adapter Facade
 *
 * Refactored into a facade that delegates to focused sub-modules:
 * - StreamDeltaHandler: Handles JSON parsing, progressive healing, and structured updates.
 * - MarkdownAccumulator: Reconstructs display markdown monotonically.
 * - StreamStatusTracker: Manages starts, models, fallbacks, completions, and errors.
 */

import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { validateFragment, validateDimension } from '@/lib/validators/synthesis';
import {
  type UCISDimension,
  type PersonaConfigV2,
  type KnowledgeGraphV2,
  type ClassificationData,
} from '@/lib/types/synthesis-nucleus';
import { StreamDeltaHandler } from './stream-delta-handler';
import { MarkdownAccumulator } from './markdown-accumulator';
import { StreamStatusTracker } from './stream-status-tracker';

export interface StreamAdapterOptions {
  onError?: (error: string, code?: string) => void;
  onComplete?: () => void;
  onProgress?: (received: number, expected: number) => void;
  isPartialStream?: boolean;
  dimensions?: number[];
}

export class SynthesisStreamAdapter {
  private synthStore = useSynthesisNucleus;
  private analysisStore = useAnalysisStore;
  private options: StreamAdapterOptions;
  private isComplete: boolean = false;

  private deltaHandler = new StreamDeltaHandler();
  private markdownAccumulator = new MarkdownAccumulator();
  private statusTracker = new StreamStatusTracker();

  constructor(options: StreamAdapterOptions = {}) {
    this.options = options;
  }

  // Expose rawSink getter/setter for compatibility/tests
  get rawSink(): string {
    return this.deltaHandler.getRawSink();
  }

  set rawSink(val: string) {
    this.deltaHandler.setRawSink(val);
  }

  // Expose healJson for compatibility/tests
  healJson(text: string): string | null {
    return this.deltaHandler.healJson(text);
  }

  processLine(line: string) {
    if (this.isComplete) return;
    if (!line.trim()) return;

    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch (err) {
      console.error('[Adapter] JSON parse failed:', err, 'line:', line.slice(0, 200));
      return;
    }

    const validation = validateFragment(data);
    if (!validation.success) {
      console.error('[Adapter] Fragment validation failed, skipping:', {
        errors: validation.error.flatten(),
        data: JSON.stringify(data).slice(0, 200),
      });
      return;
    }

    const fragment = validation.data;

    switch (fragment.type) {
      case 'status':
        this.statusTracker.handleStatus(
          fragment,
          this.options,
          () => this.deltaHandler.clear(),
          (force) => this.markdownAccumulator.rebuildDisplayMarkdown(force)
        );
        break;
      case 'delta':
        this.deltaHandler.handleDelta(
          fragment.content,
          this.options,
          () => this.markdownAccumulator.rebuildDisplayMarkdown(false)
        );
        break;
      case 'dimension':
        this.handleDimension(fragment);
        break;
      case 'metadata':
        this.handleMetadata();
        break;
      case 'complete':
      case 'done':
        this.isComplete = true;
        this.statusTracker.handleComplete(
          fragment,
          this.options,
          this.options.onComplete
        );
        break;
      case 'error':
        this.isComplete = true;
        this.statusTracker.handleError(
          fragment,
          this.options.onError
        );
        break;
      case 'persona':
        this.handlePersona(fragment);
        break;
      case 'kg':
        this.handleKG(fragment);
        break;
      case 'classification':
        this.handleClassification(fragment);
        break;
      default:
        break;
    }
  }

  private handleDimension(fragment: {
    type: 'dimension';
    dimension: number;
    name: string;
    content: string;
    metadata?: any;
  }) {
    const targetDims = this.options.dimensions;
    if (targetDims !== undefined && !targetDims.includes(fragment.dimension)) {
      return;
    }

    const dimension: UCISDimension = {
      number: fragment.dimension,
      name: fragment.name,
      content: fragment.content,
      metadata: fragment.metadata,
    };

    const entityValidation = validateDimension(dimension);
    if (!entityValidation.success) return;

    const store = this.synthStore.getState();
    store.addDimension(entityValidation.data);

    this.analysisStore.getState().logOk(`Synthesized Dimension ${fragment.dimension}: ${fragment.name}`);

    if (this.options.onProgress) {
      const state = this.synthStore.getState();
      const proj = state.projection;
      if (proj) {
        this.options.onProgress(proj.progress.received, proj.progress.expected);
      }
    }
  }

  private handleMetadata() {
    // metadata received
  }

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

  reset() {
    this.deltaHandler.clear();
    this.synthStore.getState().reset();
    this.analysisStore.getState().clearTerminal();
  }
}

export function useStreamAdapter(options?: StreamAdapterOptions) {
  return new SynthesisStreamAdapter(options);
}
