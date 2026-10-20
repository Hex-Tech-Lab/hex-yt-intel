// T24: the model's Insufficient Data Protocol placeholder (UCIS 0.6) is a long
// bracketed sentence that, repeated per field, dominates a dimension. Render it
// as a short italic marker instead. Covers the live variants: bare, in table
// cells, single/double-quoted, and the abbreviated `[Insufficient data...]`.
// Matches ONLY the two exact forms the Dim 7 prompt emits (ucis-v5.4.ts). Case-sensitive
// and anchored to the closing bracket, so content notes such as
// "[Insufficient data quality in the sample]" or "[insufficient data]" are left alone.
const PLACEHOLDER =
  /(['"]?)\[(?:Insufficient data in source transcript to fulfill this dimension|Insufficient data\.\.\.)\]\1/gu;

export const INSUFFICIENT_DATA_LABEL = '_Not stated in the video_';

export function shortenInsufficientData(markdown: string): string {
  return markdown.replace(PLACEHOLDER, INSUFFICIENT_DATA_LABEL);
}
