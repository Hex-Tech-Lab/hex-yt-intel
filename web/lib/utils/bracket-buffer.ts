/**
 * BracketBuffer — Zero-Regex JSON Fragment Buffer
 *
 * Programmatic state machine that tracks {, [, and " to yield complete JSON
 * fragments from a streaming text source. Ignores brackets inside string literals.
 *
 * ADR 006: Phase 2 — Structured JSON Streaming
 *
 * Design:
 * - Pure character-by-character processing. No regex.
 * - String-literal aware: " toggles in/out of string context, \ is escape.
 * - Emits complete top-level JSON objects as they close (depth returns to 0).
 * - flush() attempts auto-close of truncated objects by counting and closing.
 */

export type FragmentType = 'dimension' | 'persona' | 'kg' | 'classification';

export interface BufferedFragment {
  type: FragmentType;
  dimension?: number;
  name?: string;
  content?: string;
  config?: unknown;
  nodes?: unknown[];
  edges?: unknown[];
  rootId?: string | null;
  data?: unknown;
  _raw?: string;
}

export class BracketBuffer {
  private buffer: string = '';
  private depth = 0;
  private inString = false;
  private escaped = false;
  private objectStart = -1;
  private readonly emitted = new Set<number>();

  /**
   * Feed a chunk of text into the buffer.
   * Returns array of complete JSON fragments found.
   */
  feed(chunk: string): BufferedFragment[] {
    this.buffer += chunk;
    const fragments: BufferedFragment[] = [];

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

      if (char === '{' || char === '[') {
        if (this.depth === 0) this.objectStart = i;
        this.depth++;
      } else if (char === '}' || char === ']') {
        this.depth--;
        if (this.depth === 0 && this.objectStart >= 0) {
          const jsonStr = this.buffer.slice(this.objectStart, i + 1);
          const frag = this.tryParse(jsonStr);
          if (frag) fragments.push(frag);
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

  /**
   * Attempt to parse a JSON string as a fragment.
   * Returns null if parse fails or fragment is not a recognized type.
   */
  private tryParse(jsonStr: string): BufferedFragment | null {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(jsonStr);
    } catch {
      console.warn('[BracketBuffer] Parse failed:', jsonStr.slice(0, 120));
      return null;
    }

    if (obj && typeof obj.number === 'number' && typeof obj.content === 'string') {
      const num = obj.number;
      if (num >= 1 && num <= 11 && !this.emitted.has(num)) {
        this.emitted.add(num);
        const name = typeof obj.name === 'string' ? obj.name : `Dimension ${num}`;
        return { type: 'dimension', dimension: num, name, content: obj.content, _raw: jsonStr };
      }
    }

    if (obj?.type === 'persona' && obj.config) {
      return { type: 'persona', config: obj.config, _raw: jsonStr };
    }
    if (obj?.type === 'kg') {
      const nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
      const edges = Array.isArray(obj.edges) ? obj.edges : [];
      const rootId = typeof obj.rootId === 'string' ? obj.rootId : null;
      return { type: 'kg', nodes, edges, rootId, _raw: jsonStr };
    }
    if (obj?.type === 'classification') {
      return { type: 'classification', data: obj.data, _raw: jsonStr };
    }

    return null;
  }

  /**
   * Flush remaining buffer content, attempting to auto-close truncated JSON.
   * Returns any fragments parsed from the repaired content.
   */
  flush(): BufferedFragment[] {
    if (!this.buffer.trim()) return [];
    const fragments: BufferedFragment[] = [];

    const repaired = this.autoClose(this.buffer);
    if (repaired) {
      const frag = this.tryParse(repaired);
      if (frag) fragments.push(frag);
    }

    this.buffer = '';
    this.objectStart = -1;
    return fragments;
  }

  /**
   * Auto-close an unclosed JSON object/array by counting open brackets
   * and appending the required closing brackets in correct order.
   */
  private autoClose(text: string): string | null {
    const stack: string[] = [];
    let inStr = false;
    let esc = false;

    for (const char of text) {
      if (esc) { esc = false; continue; }
      if (char === '\\' && inStr) { esc = true; continue; }
      if (char === '"') { inStr = !inStr; continue; }
      if (inStr) continue;

      if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
      else if (char === '}' || char === ']') stack.pop();
    }

    if (inStr) text += '"';
    text = text.replace(/,\s*$/, '').trim();
    while (stack.length > 0) {
      const closer = stack.pop();
      if (closer) text += closer;
    }

    try {
      JSON.parse(text);
      return text;
    } catch {
      return null;
    }
  }

  getState() {
    return {
      bufferLen: this.buffer.length,
      depth: this.depth,
      inString: this.inString,
      objectStart: this.objectStart,
      emitted: [...this.emitted],
    };
  }
}