import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import { type StreamAdapterOptions } from './synthesis-stream-adapter';

export class StreamDeltaHandler {
  private rawSink = '';
  private synthStore = useSynthesisNucleus;
  private analysisStore = useAnalysisStore;

  constructor() {}

  getRawSink(): string {
    return this.rawSink;
  }

  setRawSink(val: string) {
    this.rawSink = val;
  }

  clear() {
    this.rawSink = '';
  }

  public healJson(text: string): string | null {
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

  public handleDelta(
    content: string,
    options: StreamAdapterOptions,
    rebuildMarkdown: () => void
  ): boolean {
    const store = this.analysisStore.getState();

    // Progressive JSON Parsing (Dual-Accumulator Pattern)
    this.rawSink += content;

    let cleanSink = this.rawSink.trim();
    if (cleanSink.startsWith('```')) {
      const braceIndex = cleanSink.indexOf('{');
      if (braceIndex !== -1) {
        cleanSink = cleanSink.slice(braceIndex);
      }
    }
    // Only strip markdown code fence closers, not stray backticks in JSON strings
    if (cleanSink.endsWith('```')) {
      cleanSink = cleanSink.slice(0, -3).trimEnd();
    }

    // Check if the raw sink starts with '{', indicating it is a structured JSON stream
    const isJsonStream = cleanSink.startsWith('{');

    // Only append to raw display markdown if this is NOT a JSON stream (legacy/fallback plaintext)
    if (!isJsonStream) {
      store.appendMarkdown(content);
    }
    console.debug('[Adapter] Delta received:', content.slice(0, 100));

    const healed = this.healJson(cleanSink);
    if (healed) {
      let obj: any;
      try {
        obj = JSON.parse(healed);
      } catch {
        // Expected parsing failures on incomplete JSON stream
        return isJsonStream;
      }

      try {
        if (obj && obj.schemaVersion === '2.0') {
          // Check if the raw sink itself is already a fully valid complete JSON object
          let isRawComplete = false;
          try {
            JSON.parse(cleanSink);
            isRawComplete = true;
          } catch {}

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
            }
          }

          // 2. Validate and add Dimensions (filtered by bundle)
          if (Array.isArray(obj.dimensions)) {
            const targetDims = options.dimensions;
            for (const dim of obj.dimensions) {
              if (
                dim &&
                typeof dim.number === 'number' &&
                dim.number >= 1 &&
                dim.number <= TOTAL_DIMENSIONS &&
                typeof dim.content === 'string'
              ) {
                if (targetDims !== undefined && !targetDims.includes(dim.number)) {
                  continue;
                }
                this.synthStore.getState().addDimension({
                  number: dim.number,
                  name: dim.name || `Dimension ${dim.number}`,
                  content: dim.content,
                });
              }
            }
          }

          // 3. Validate and set Knowledge Graph
          if (obj.knowledgeGraph && typeof obj.knowledgeGraph === 'object') {
            const kg = obj.knowledgeGraph;
            if (Array.isArray(kg.nodes)) {
              const validNodes = kg.nodes.every((n: any) => n && typeof n === 'object' && typeof n.id === 'string' && typeof n.label === 'string' && n.label.trim().length > 0);
              if (validNodes) {
                this.synthStore.getState().setKnowledgeGraph({
                  nodes: kg.nodes,
                  edges: Array.isArray(kg.edges) ? kg.edges : [],
                  rootId: typeof kg.rootId === 'string' || kg.rootId === null ? kg.rootId : null,
                });
              }
            }
          }

          // 4. Validate and set Classification
          if (obj.classification && typeof obj.classification === 'object') {
            const c = obj.classification;
            if (
              typeof c.authoritative === 'boolean' &&
              typeof c.recommendation === 'string' &&
              typeof c.practicallyActionable === 'boolean' &&
              typeof c.knowledgeGraphReady === 'boolean' &&
              typeof c.safe === 'boolean'
            ) {
              this.synthStore.getState().setClassification(c);
            }
          }

          // 5. Validate and set Monetization Verdict
          if (obj.monetizationVerdict && typeof obj.monetizationVerdict === 'object') {
            this.synthStore.getState().setMonetizationVerdict(obj.monetizationVerdict);
          }

          // 6. Reconstruct displayed markdown
          if (isJsonStream) {
            rebuildMarkdown();
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

    return isJsonStream;
  }
}
