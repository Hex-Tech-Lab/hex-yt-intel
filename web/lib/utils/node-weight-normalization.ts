export function normalizeNodeWeight(
  frequency: number,
  relevanceScore: number,
): number {
  // Logarithmic frequency dampening: W_norm = log(1 + f) * S_relevance
  // If S_relevance is 1-10, maybe we should scale it to 0.1-1.0 first?
  // Actually, W_norm = log(1 + f) * S_relevance
  // Let's just implement exactly what is asked.
  const wNorm = Math.log(1 + frequency) * relevanceScore;
  return Math.max(0.1, Math.min(1.0, wNorm));
}
