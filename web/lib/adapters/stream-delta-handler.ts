import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import { ClassificationDataSchema } from '@/lib/validators/synthesis';
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
    } catch (healErr) {
      // Not display truncation: healJson returns null on failure and the
      // caller falls back to plaintext markdown, so no ellipsis applies.
      console.error('[Adapter] JSON heal failed:', healErr instanceof Error ? healErr.message : healErr);
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
      // Strip everything before the first '{' (markdown fence prefix) — this
      // is JSON-sink normalization, not display truncation, so no ellipsis.
      cleanSink = cleanSink.replace(/^[^{]*/, '');
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

    const healed = this.healJson(cleanSink);
    if (healed) {
      let obj: any;
      try {
        obj = JSON.parse(healed);
      } catch (parseErr) {
        // Expected parsing failures on incomplete JSON stream
        console.error('[Adapter] healed JSON still unparseable:', parseErr instanceof Error ? parseErr.message : parseErr);
        return isJsonStream;
      }

      try {
        if (obj && obj.schemaVersion === '2.0') {
          // Check if the raw sink itself is already a fully valid complete JSON object.
          // This probe runs on every delta while the sink is still accumulating, so a
          // parse failure here is the expected steady state, not an anomaly -- and it
          // can fail with many different V8 error shapes depending on exactly where the
          // string got cut off ("Unterminated string", "Expected ',' or '}'", "Expected
          // property name", etc.), not just "Unexpected end of JSON". Whitelisting one
          // message and warning on the rest logged hundreds of false-positive warnings
          // per streamed analysis (and fed Sentry's tunnel into 429s from the volume).
          // There is nothing actionable here until the stream actually finishes -- if
          // isRawComplete is still false after the LAST delta, that's a real bug, but
          // this per-delta probe can't distinguish "mid-stream" from "genuinely stuck".
          let isRawComplete = false;
          try {
            JSON.parse(cleanSink);
            isRawComplete = true;
          } catch (err) {
            // Expected while the stream is still accumulating -- gated behind the same
            // opt-in debug flag used elsewhere in this codebase (window.__CHAT_DEBUG) so
            // it stays fully silent by default instead of warning on every delta.
            if (typeof window !== 'undefined' && window.__CHAT_DEBUG) {
              console.debug('[Adapter] raw sink not yet complete (expected mid-stream):', err instanceof Error ? err.message : err);
            }
          }

          // 1. Validate and set Persona
          if (obj.persona && typeof obj.persona === 'object') {
            const persona = obj.persona;
            if (
              persona.primary &&
              typeof persona.primary === 'object' &&
              typeof persona.primary.id === 'string' &&
              typeof persona.primary.label === 'string' &&
              typeof persona.primary.weight === 'number' &&
              Array.isArray(persona.cognitiveLenses) &&
              typeof persona.selectionRationale === 'string'
            ) {
              this.synthStore.getState().setPersonaConfig(persona);
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
          // Same schema as the SSE classification frame, so aliases and
          // missing qualifiers are handled identically on both paths.
          if (obj.classification && typeof obj.classification === 'object') {
            const parsed = ClassificationDataSchema.safeParse(obj.classification);
            if (parsed.success) {
              this.synthStore.getState().setClassification(parsed.data);
            } else {
              // Log paths/codes only -- never the raw values, which can carry
              // transcript-derived content into the console/Sentry.
              console.warn('[Adapter] classification rejected', parsed.error.issues.map((i) => i.path.join('.') + ':' + i.code));
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
