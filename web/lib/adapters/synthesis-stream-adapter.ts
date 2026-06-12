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
  private rawSink: string = '';

  constructor(options: StreamAdapterOptions = {}) {
    this.options = options;
  }

  private healJson(text: string): string | null {
    const stack: string[] = [];
    let inStr = false;
    let esc = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (char === '\\' && inStr) {
        esc = true;
        continue;
      }
      if (char === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;

      if (char === '{' || char === '[') {
        stack.push(char === '{' ? '}' : ']');
      } else if (char === '}' || char === ']') {
        stack.pop();
      }
    }

    let healed = text;
    if (inStr) healed += '"';
    healed = healed.replace(/,\s*$/, '').trim();
    while (stack.length > 0) {
      const closer = stack.pop();
      if (closer) healed += closer;
    }

    try {
      JSON.parse(healed);
      return healed;
    } catch {
      return null;
    }
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
      // Reset rawSink buffer to prevent stale partial JSON from corrupting the fallback model run
      this.rawSink = '';

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

    // Progressive JSON Parsing (Dual-Accumulator Pattern)
    this.rawSink += fragment.content;

    // Check if the raw sink starts with '{', indicating it is a structured JSON stream
    const isJsonStream = this.rawSink.trim().startsWith('{');

    // Only append to raw display markdown if this is NOT a JSON stream (legacy/fallback plaintext)
    if (!isJsonStream) {
      store.appendMarkdown(fragment.content);
    }
    console.debug('[Adapter] Delta received:', fragment.content.slice(0, 100));

    // Check if the raw sink itself is already a fully valid complete JSON object
    let isRawComplete = false;
    try {
      JSON.parse(this.rawSink);
      isRawComplete = true;
    } catch {}

    const healed = this.healJson(this.rawSink);
    if (healed) {
      let obj: any;
      try {
        obj = JSON.parse(healed);
      } catch {
        // Expected parsing failures on incomplete JSON stream
        return;
      }

      try {
        if (obj && obj.schemaVersion === '2.0') {
          // If this is a JSON stream, dynamically reconstruct clean markdown and update the store
          if (isJsonStream && store.analysis) {
            const reconstructed = this.reconstructMarkdown(obj);
            store.setAnalysis({
              ...store.analysis,
              analysis_markdown: reconstructed,
            });
          }
          // 1. Validate and set Persona
          if (obj.persona && typeof obj.persona === 'object') {
            const p = obj.persona;
            if (
              p.primary &&
              typeof p.primary === 'object' &&
              typeof p.primary.id === 'string' &&
              typeof p.primary.label === 'string' &&
              typeof p.primary.weight === 'number' &&
              Array.isArray(p.cognitiveLenses) &&
              typeof p.selectionRationale === 'string'
            ) {
              this.synthStore.getState().setPersonaConfig(p);
            } else {
              console.warn('[Adapter] Invalid persona payload format, skipping setPersonaConfig');
            }
          }

          // 2. Validate and add Dimensions
          if (Array.isArray(obj.dimensions)) {
            for (const dim of obj.dimensions) {
              if (
                dim &&
                typeof dim.number === 'number' &&
                dim.number >= 1 &&
                dim.number <= 11 &&
                typeof dim.content === 'string' &&
                (typeof dim.name === 'string' || dim.name === undefined)
              ) {
                this.synthStore.getState().addDimension({
                  number: dim.number,
                  name: dim.name || `Dimension ${dim.number}`,
                  content: dim.content,
                });
              } else {
                console.warn('[Adapter] Invalid dimension entry format, skipping addDimension:', dim);
              }
            }
          }

          // 3. Validate and set Knowledge Graph
          if (obj.knowledgeGraph && typeof obj.knowledgeGraph === 'object') {
            const kg = obj.knowledgeGraph;
            if (Array.isArray(kg.nodes)) {
              // Ensure nodes are actually objects
              const validNodes = kg.nodes.every(
                (node: any) =>
                  node &&
                  typeof node === 'object' &&
                  typeof node.id === 'string' &&
                  typeof node.label === 'string'
              );
              if (validNodes) {
                this.synthStore.getState().setKnowledgeGraph({
                  nodes: kg.nodes,
                  edges: Array.isArray(kg.edges) ? kg.edges : [],
                  rootId: typeof kg.rootId === 'string' || kg.rootId === null ? kg.rootId : null,
                });
              } else {
                console.warn('[Adapter] Invalid knowledge graph nodes format, skipping setKnowledgeGraph');
              }
            } else {
              console.warn('[Adapter] Knowledge graph nodes is not an array, skipping setKnowledgeGraph');
            }
          }

          // 4. Validate and set Classification
          if (obj.classification && typeof obj.classification === 'object') {
            const c = obj.classification;
            if (
              typeof c.authoritative === 'boolean' &&
              typeof c.practicallyActionable === 'boolean' &&
              typeof c.knowledgeGraphReady === 'boolean' &&
              typeof c.safe === 'boolean' &&
              typeof c.personaOptimised === 'boolean' &&
              typeof c.recommendation === 'string'
            ) {
              this.synthStore.getState().setClassification(c);
            } else {
              console.warn('[Adapter] Invalid classification payload format, skipping setClassification');
            }
          }

          // Reset the sink if we have processed the final complete unhealed object
          if (isRawComplete) {
            this.rawSink = '';
          }
        }
      } catch (err) {
        console.error('[Adapter] Failed to process progressive JSON updates:', err);
      }
    }
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

  private reconstructMarkdown(payload: any): string {
    const lines: string[] = [];

    // Persona header (text format for backward compat)
    if (payload.persona) {
      lines.push('=== PERSONA CONFIGURATION ===');
      if (payload.persona.primary?.label) {
        lines.push(`Primary Persona:    ${payload.persona.primary.label} (Weight: ${Math.round((payload.persona.primary.weight || 0) * 100)}%)`);
      }
      if (payload.persona.secondary?.label) {
        lines.push(`Secondary Persona:  ${payload.persona.secondary.label} (Weight: ${Math.round((payload.persona.secondary.weight || 0) * 100)}%)`);
      }
      if (payload.persona.tertiary?.label) {
        lines.push(`Tertiary Persona:   ${payload.persona.tertiary.label} (Weight: ${Math.round((payload.persona.tertiary.weight || 0) * 100)}%)`);
      }
      if (Array.isArray(payload.persona.cognitiveLenses)) {
        lines.push(`Active Cognitive Lenses: [${payload.persona.cognitiveLenses.join(', ')}]`);
      }
      if (payload.persona.selectionRationale) {
        lines.push(`Selection Rationale: ${payload.persona.selectionRationale}`);
      }
      lines.push('==============================');
      lines.push('');
    }

    // Dimensions
    if (Array.isArray(payload.dimensions)) {
      for (const dim of payload.dimensions) {
        if (dim && typeof dim.number === 'number' && typeof dim.content === 'string') {
          const name = dim.name || `Dimension ${dim.number}`;
          lines.push(`### DIMENSION ${dim.number} – ${name.toUpperCase()}`);
          lines.push('');
          lines.push(dim.content);
          lines.push('');
        }
      }
    }

    // Classification (if present)
    if (payload.classification) {
      lines.push('=== CLASSIFICATION ===');
      if (payload.classification.authoritative !== undefined) {
        lines.push(`Authoritative:           ${payload.classification.authoritative}`);
      }
      if (payload.classification.practicallyActionable !== undefined) {
        lines.push(`Practically Actionable:  ${payload.classification.practicallyActionable}`);
      }
      if (payload.classification.knowledgeGraphReady !== undefined) {
        lines.push(`Knowledge Graph Ready:   ${payload.classification.knowledgeGraphReady}`);
      }
      if (payload.classification.safe !== undefined) {
        lines.push(`Safe:                    ${payload.classification.safe}`);
      }
      if (payload.classification.personaOptimised !== undefined) {
        lines.push(`Persona Optimised:       ${payload.classification.personaOptimised}`);
      }
      if (payload.classification.recommendation !== undefined) {
        lines.push(`Recommendation:          ${payload.classification.recommendation}`);
      }
      lines.push('');
    }

    // Monetization verdicts (if present)
    if (payload.monetizationVerdict) {
      lines.push('=== MONETIZATION VERDICTS ===');
      lines.push(`Creator:         ${payload.monetizationVerdict.creator || 'N/A'}`);
      lines.push(`Indie Maker:     ${payload.monetizationVerdict.indieMaker || 'N/A'}`);
      lines.push(`Consultant:      ${payload.monetizationVerdict.consultant || 'N/A'}`);
      lines.push(`Researcher:      ${payload.monetizationVerdict.researcher || 'N/A'}`);
      lines.push(`Product Manager: ${payload.monetizationVerdict.productManager || 'N/A'}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Reset adapter state for new stream
   */
  reset() {
    this.rawSink = '';
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
