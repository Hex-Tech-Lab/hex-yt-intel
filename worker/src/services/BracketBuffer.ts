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
  private emittedDimensions: Set<number> = new Set();

  feed(chunk: string): DimensionFragment[] {
    this.buffer += chunk;
    const fragments: DimensionFragment[] = [];

    for (let i = this.objectStart === -1 ? 0 : this.objectStart; i < this.buffer.length; i++) {
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
        this.depth--;
        if (this.depth === 0 && this.objectStart >= 0) {
          const jsonStr = this.buffer.slice(this.objectStart, i + 1);
          const fragment = this.tryParseDimension(jsonStr);
          if (fragment) {
            fragments.push(fragment);
          }
          this.objectStart = -1;
        }
      }
    }

    if (this.objectStart > 0) {
      this.buffer = this.buffer.slice(this.objectStart);
      this.objectStart = 0;
    } else if (this.objectStart === -1) {
      this.buffer = '';
    }

    return fragments;
  }

  private tryParseDimension(jsonStr: string): DimensionFragment | null {
    try {
      const obj = JSON.parse(jsonStr);
      if (obj && typeof obj.number === 'number' && typeof obj.content === 'string') {
        const dimNum = obj.number;
        if (dimNum >= 1 && dimNum <= 11 && !this.emittedDimensions.has(dimNum)) {
          this.emittedDimensions.add(dimNum);
          return {
            type: 'dimension',
            dimension: dimNum,
            name: obj.name || `Dimension ${dimNum}`,
            content: obj.content,
            metadata: obj.metadata,
          };
        }
      }
      if (obj && obj.type === 'persona') {
        return { type: 'persona', config: obj.config };
      }
      if (obj && obj.type === 'kg') {
        return { type: 'kg', nodes: obj.nodes, edges: obj.edges, rootId: obj.rootId };
      }
      if (obj && obj.type === 'classification') {
        return { type: 'classification', data: obj.data };
      }
    } catch {
      console.warn('[BracketBuffer] Failed to parse object:', jsonStr.slice(0, 200));
    }
    return null;
  }

  finalize(): DimensionFragment[] {
    if (!this.buffer.trim()) return [];
    const fragments: DimensionFragment[] = [];

    const repaired = this.repairUnclosedJson(this.buffer);
    if (repaired) {
      const fragment = this.tryParseDimension(repaired);
      if (fragment) fragments.push(fragment);
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