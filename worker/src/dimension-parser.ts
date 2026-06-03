/**
 * Streaming Dimension Parser: Converts markdown stream into JSON fragments
 *
 * Input: Markdown text with pattern "### DIMENSION N - NAME\n content\n\n..."
 * Output: JSON fragments {dimension: N, name: string, content: string}
 *
 * Handles partial/streaming input gracefully — only emits complete dimensions
 */

export interface DimensionFragment {
  type: 'dimension' | 'complete' | 'error';
  dimension?: number;
  name?: string;
  content?: string;
}

export class StreamingDimensionParser {
  private buffer: string = '';
  private lastEmittedDimension: number = 0;
  private dimensionPattern = /^###\s+DIMENSION\s+(\d+)\s*[-–—:]\s*(.+)$/m;
  private dimensionSeparator = /^###\s+DIMENSION\s+\d+\s*[-–—:]/m;

  /**
   * Feed markdown chunk into the parser
   * Returns array of complete dimension fragments ready to send
   */
  feed(chunk: string): DimensionFragment[] {
    this.buffer += chunk;
    const fragments: DimensionFragment[] = [];

    // Extract all complete dimensions from buffer
    let match;
    while ((match = this.dimensionPattern.exec(this.buffer))) {
      const dimensionNum = parseInt(match[1], 10);
      const dimensionName = match[2].trim();

      // Find where this dimension ends (start of next dimension or end of buffer)
      const dimensionStart = match.index;
      const nextDimensionMatch = this.dimensionSeparator.exec(this.buffer.slice(dimensionStart + match[0].length));
      const dimensionEnd = nextDimensionMatch
        ? dimensionStart + match[0].length + nextDimensionMatch.index
        : this.buffer.length;

      const fullDimensionText = this.buffer.slice(dimensionStart, dimensionEnd);
      const contentStart = fullDimensionText.indexOf('\n') + 1;
      const content = fullDimensionText.slice(contentStart).trim();

      // Only emit if we have meaningful content
      if (content.length > 10) {
        fragments.push({
          type: 'dimension',
          dimension: dimensionNum,
          name: dimensionName,
          content: content,
        });
        this.lastEmittedDimension = dimensionNum;

        // Remove this dimension from buffer so we don't re-parse it
        this.buffer = this.buffer.slice(dimensionEnd);
      } else {
        // Incomplete dimension content, keep in buffer for next chunk
        break;
      }
    }

    return fragments;
  }

  /**
   * Finalize: emit any remaining partial dimension if we reach stream end
   * Called when stream completes (success or error)
   */
  finalize(): DimensionFragment[] {
    if (!this.buffer.trim()) return [];

    const fragments: DimensionFragment[] = [];
    const match = this.dimensionPattern.exec(this.buffer);

    if (match) {
      const dimensionNum = parseInt(match[1], 10);
      const dimensionName = match[2].trim();
      const contentStart = this.buffer.indexOf('\n', match.index) + 1;
      const content = this.buffer.slice(contentStart).trim();

      if (content.length > 5) {
        fragments.push({
          type: 'dimension',
          dimension: dimensionNum,
          name: dimensionName,
          content,
        });
      }
    }

    this.buffer = '';
    return fragments;
  }

  /**
   * Get parser state (for debugging)
   */
  getState() {
    return {
      bufferLength: this.buffer.length,
      lastEmitted: this.lastEmittedDimension,
      buffer: this.buffer.slice(0, 100) + (this.buffer.length > 100 ? '...' : ''),
    };
  }
}
