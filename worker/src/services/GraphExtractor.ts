export function normalizeNodeWeight(frequency: number, relevanceScore: number): number {
  const wNorm = Math.log(1 + frequency) * relevanceScore;
  return Math.max(0.1, Math.min(1.0, wNorm));
}

export class GraphExtractor {
}
