/**
 * Lightweight dimension parser for cache-hit rehydration shield.
 * Extracts dimension presence (1–11) from markdown.
 * Used by bouncer to detect poisoned/incomplete caches before returning to client.
 */

/**
 * Parse markdown to extract dimension numbers that are present.
 * Fast regex-only check; returns empty object if markdown is a 101-char stub.
 *
 * @param markdown Raw analysis markdown from cache
 * @returns Record mapping dimension number → dimension title/presence
 */
export function parseDimensions(markdown: string): Record<number, string> {
  const dimensions: Record<number, string> = {};

  if (!markdown || typeof markdown !== 'string') {
    return dimensions;
  }

  // Regex: match "### DIMENSION N" or "# DIMENSION N" (handles variations in markdown level)
  const dimensionRegex = /^#{1,4}\s+DIMENSION\s+(\d+)\s*[-–—:]\s*(.+?)$/gm;

  let match: RegExpExecArray | null;
  while ((match = dimensionRegex.exec(markdown)) !== null) {
    const number = parseInt(match[1] ?? '0', 10);
    const title = (match[2] ?? '').trim();

    // Only accept valid dimension numbers (1–11, though most analyses use 1–10)
    if (number >= 1 && number <= 11) {
      dimensions[number] = title;
    }
  }

  return dimensions;
}

/**
 * Quick validation: check if dimensions object has meaningful content.
 * Returns false for empty stubs (e.g., 101-char "Parsing..." placeholders).
 *
 * @param dimensions Parsed dimension record
 * @returns true if dimensions map has at least 8 valid entries (min viable analysis)
 */
export function hasSufficientDimensions(dimensions: Record<number, string>): boolean {
  const count = Object.keys(dimensions).length;
  return count >= 8; // At least 8 out of 10+ dimensions required
}
