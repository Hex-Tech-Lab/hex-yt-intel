export function normalizeNodeWeight(
  frequency: number,
  relevanceScore: number,
): number {
  const f = Number.isFinite(frequency) && frequency >= 0 ? frequency : 0;
  const s = Number.isFinite(relevanceScore) && relevanceScore >= 0 ? relevanceScore : 1;
  
  // Scale relevance from 1-10 to 0.1-1.0 if it's > 1, 
  // since relevanceScore in prompt could be 1-10
  const normalizedS = s > 1 ? s / 10.0 : s;

  const wNorm = Math.log(1 + f) * normalizedS;
  const clamped = Math.max(0.1, Math.min(10.0, wNorm)); // allow up to 10
  
  return Number.isNaN(clamped) || !Number.isFinite(clamped) ? 0.5 : clamped;
}

export function normalizeNodesWeights(stitchedNodes: unknown[]) {
  const frequencyMap = new Map<string, number>();
  for (const node of stitchedNodes) {
    if (node && typeof node === "object" && "label" in node) {
      const label = String((node as any).label)
        .toLowerCase()
        .trim();
      frequencyMap.set(label, (frequencyMap.get(label) || 0) + 1);
    }
  }

  for (const node of stitchedNodes) {
    if (node && typeof node === "object" && "weight" in node) {
      const label = String((node as any).label)
        .toLowerCase()
        .trim();
      const f = frequencyMap.get(label) || 1;

      const rawWeight =
        typeof (node as any).weight === "number"
          ? (node as any).weight
          : Number((node as any).weight);
          
      (node as { weight: number }).weight = normalizeNodeWeight(f, rawWeight);
    }
  }
}
