/**
 * Hallucination filter utility for export generation.
 * Strips AI hallucination blocks that contain "[Insufficient data in source transcript to fulfill this dimension]"
 * from markdown content at the moment of export - does NOT mutate database payload.
 */

export const HALLUCINATION_BLOCK = '[Insufficient data in source transcript to fulfill this dimension]';

/**
 * Filters out lines/bullet points containing the hallucination block.
 * Preserves structure while removing the placeholder content.
 */
export function filterHallucinationContent(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') {
    return markdown;
  }

  const lines = markdown.split(/\r?\n/);
  const filtered = lines
    .map((line) => {
      if (line.includes(HALLUCINATION_BLOCK)) {
        return '';
      }
      return line;
    })
    .filter((line, index, arr) => {
      if (line.trim() === '') {
        const nextNonEmpty = arr.slice(index + 1).find((l) => l.trim() !== '');
        if (nextNonEmpty && nextNonEmpty.startsWith('#')) {
          return false;
        }
      }
      return true;
    });

  const result = filtered.join('\n');

  return result
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}