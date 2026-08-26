export function normalizeNodeWeight(
  frequency: number,
  relevanceScore: number,
): number {
  const freq = Number.isFinite(frequency) && frequency >= 0 ? frequency : 0;
  const score = Number.isFinite(relevanceScore) && relevanceScore >= 0 ? relevanceScore : 1;
  
  const relevanceBase = score > 1 ? score / 10.0 : score;
  const clampedRelevance = Math.max(0.1, Math.min(1.0, relevanceBase));

  const dampening = Math.log2(1 + freq);
  const wNorm = dampening * clampedRelevance;
  const clamped = Math.max(0.1, Math.min(1.0, wNorm)); 
  
  return Number.isNaN(clamped) || !Number.isFinite(clamped) ? 0.5 : clamped;
}
