export function normalizeNodeWeight(
  frequency: number,
  relevanceScore: number,
): number {
  const wNorm = Math.log(1 + frequency) * relevanceScore;
  return Math.max(0.1, Math.min(1.0, wNorm));
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
      const sRelevance = !Number.isFinite(rawWeight)
        ? 0.5
        : rawWeight > 1
          ? rawWeight / 10.0
          : rawWeight;

      (node as { weight: number }).weight = normalizeNodeWeight(f, sRelevance);
    }
  }
}
