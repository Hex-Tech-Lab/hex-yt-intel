export function normalizeNodeWeight(
  frequency: number,
  relevanceScore: number,
): number {
  const f = Number.isFinite(frequency) && frequency >= 0 ? frequency : 0;
  const s = Number.isFinite(relevanceScore) && relevanceScore >= 0 ? relevanceScore : 1;
  
  const relevanceBase = s > 1 ? s / 10.0 : s;
  const clampedRelevance = Math.max(0.1, Math.min(1.0, relevanceBase));

  const dampening = Math.log2(1 + f);
  const wNorm = dampening * clampedRelevance;
  const clamped = Math.max(0.1, Math.min(1.0, wNorm)); 
  
  return Number.isNaN(clamped) || !Number.isFinite(clamped) ? 0.5 : clamped;
}
