// T24: the model's Insufficient Data Protocol placeholder (UCIS 0.6) is a long
// bracketed sentence that, repeated per field, dominates a dimension. Render it
// as a short italic marker instead. Covers the live variants: bare, in table
// cells, single/double-quoted, and the abbreviated `[Insufficient data...]`.
const PLACEHOLDER = /(['"]?)\[Insufficient data[^\]\n]*\]\1/giu;

export const INSUFFICIENT_DATA_LABEL = '_Not stated in the video_';

export function shortenInsufficientData(markdown: string): string {
  return markdown.replace(PLACEHOLDER, INSUFFICIENT_DATA_LABEL);
}
