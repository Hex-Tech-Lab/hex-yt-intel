/**
 * BracketBuffer — Programmatic JSON stream parser
 *
 * ZERO REGEX. Purely algorithmic character-by-character processing.
 * Detects complete top-level JSON objects via bracket balancing while
 * respecting string literals and escape sequences.
 *
 * ADR 006: Structured JSON Streaming Blueprint
 */

export interface DimensionFragment {
  type: 'dimension' | 'complete' | 'error' | 'persona' | 'kg' | 'classification';
  dimension?: number;
  name?: string;
  content?: string;
  config?: unknown;
  nodes?: unknown[];
  edges?: unknown[];
  rootId?: string | null;
  data?: unknown;
}

export class BracketBuffer {
  private buffer: string = '';
  private depth: number = 0;
  private inString: boolean = false;
  private escaped: boolean = false;
  private objectStart: number = -1;
  private scanIndex: number = 0;
  private emittedDimensions: Set<number> = new Set();

  feed(chunk: string): DimensionFragment[] {
    this.buffer += chunk;
    const fragments: DimensionFragment[] = [];
    const startAt = this.scanIndex;

    for (let i = startAt; i < this.buffer.length; i++) {
      const char = this.buffer[i];

      if (this.escaped) {
        this.escaped = false;
        continue;
      }

      if (char === '\\' && this.inString) {
        this.escaped = true;
        continue;
      }

      if (char === '"') {
        this.inString = !this.inString;
        continue;
      }

      if (this.inString) continue;

      if (char === '{') {
        if (this.depth === 0) {
          this.objectStart = i;
        }
        this.depth++;
      } else if (char === '}') {
        this.depth = Math.max(0, this.depth - 1);
        if (this.depth === 0 && this.objectStart >= 0) {
          const jsonStr = this.buffer.slice(this.objectStart, i + 1);
          const newFragments = this.tryParseDimension(jsonStr);
          if (newFragments.length > 0) {
            fragments.push(...newFragments);
          }
          this.objectStart = -1;
        }
      }
    }

    this.scanIndex = this.buffer.length;

    if (this.objectStart > 0) {
      this.buffer = this.buffer.slice(this.objectStart);
      this.scanIndex = 0;
      this.objectStart = 0;
    } else if (this.objectStart === -1) {
      this.buffer = '';
      this.scanIndex = 0;
    }

    return fragments;
  }

  private tryParseDimension(jsonStr: string): DimensionFragment[] {
    const fragments: DimensionFragment[] = [];
    try {
      const obj = JSON.parse(jsonStr);

      // v2.0 schema: top-level payload with dimensions array
      if (obj && obj.schemaVersion === '2.0' && Array.isArray(obj.dimensions)) {
        // Emit persona fragment if present
        if (obj.persona) {
          fragments.push({ type: 'persona', config: obj.persona });
        }

        // Emit each dimension from the dimensions array
        for (const dim of obj.dimensions) {
          if (
            typeof dim.number === 'number' &&
            typeof dim.content === 'string' &&
            dim.number >= 1 &&
            dim.number <= 11 &&
            !this.emittedDimensions.has(dim.number)
          ) {
            this.emittedDimensions.add(dim.number);
            fragments.push({
              type: 'dimension',
              dimension: dim.number,
              name: dim.name || `Dimension ${dim.number}`,
              content: dim.content,
            });
          }
        }

        // Emit kg fragment if knowledgeGraph is present
        if (obj.knowledgeGraph && Array.isArray(obj.knowledgeGraph.nodes)) {
          fragments.push({
            type: 'kg',
            nodes: obj.knowledgeGraph.nodes,
            edges: obj.knowledgeGraph.edges || [],
            rootId: obj.knowledgeGraph.rootId ?? null,
          });
        }

        // Emit classification fragment if present
        if (obj.classification) {
          fragments.push({ type: 'classification', data: obj.classification });
        }

        return fragments;
      }

      // Legacy flat object format: {number, content, name}
      if (obj && typeof obj.number === 'number' && typeof obj.content === 'string') {
        const dimNum = obj.number;
        if (dimNum >= 1 && dimNum <= 11 && !this.emittedDimensions.has(dimNum)) {
          this.emittedDimensions.add(dimNum);
          return [{
            type: 'dimension',
            dimension: dimNum,
            name: obj.name || `Dimension ${dimNum}`,
            content: obj.content,
          }];
        }
      }

      // Legacy standalone persona//kg/classification fragments
      if (obj && obj.type === 'persona') {
        return [{ type: 'persona', config: obj.config }];
      }
      if (obj && obj.type === 'kg') {
        return [{ type: 'kg', nodes: obj.nodes, edges: obj.edges, rootId: obj.rootId }];
      }
      if (obj && obj.type === 'classification') {
        return [{ type: 'classification', data: obj.data }];
      }
    } catch {
      console.warn('[BracketBuffer] Failed to parse object:', jsonStr.slice(0, 200));
    }
    return fragments;
  }

  finalize(): DimensionFragment[] {
    if (!this.buffer.trim()) return [];
    const fragments: DimensionFragment[] = [];

    const repaired = this.repairUnclosedJson(this.buffer);
    if (repaired) {
      const newFragments = this.tryParseDimension(repaired);
      if (newFragments.length > 0) {
        fragments.push(...newFragments);
      }
    }

    this.buffer = '';
    this.objectStart = -1;
    return fragments;
  }

  private repairUnclosedJson(text: string): string | null {
    let depth = 0;
    let inStr = false;
    let esc = false;
    const closers: string[] = [];

    for (const char of text) {
      if (esc) { esc = false; continue; }
      if (char === '\\' && inStr) { esc = true; continue; }
      if (char === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (char === '{') { depth++; closers.push('}'); }
      else if (char === '[') { closers.push(']'); }
      else if (char === '}') { depth--; closers.pop(); }
      else if (char === ']') { closers.pop(); }
    }

    if (inStr) text += '"';
    text = text.replace(/,\s*$/, '');
    text += closers.reverse().join('');

    try {
      JSON.parse(text);
      return text;
    } catch {
      return null;
    }
  }

  getState() {
    return {
      bufferLength: this.buffer.length,
      depth: this.depth,
      inString: this.inString,
      emitted: [...this.emittedDimensions],
    };
  }
}