const fs = require('fs');
const path = 'web/lib/services/stitch-analysis-chunks.ts';
let content = fs.readFileSync(path, 'utf8');

// Replace import
content = content.replace(
  'import { normalizeNodeWeight, normalizeNodesWeights } from "@/lib/utils/node-weight-normalization";',
  'import { normalizeNodeWeight } from "@/lib/utils/node-weight-normalization";'
);

const oldLogic = `  // Aggregate duplicate entity nodes by canonical ID/label prior to frequency calculation
  const uniqueNodesMap = new Map<string, unknown>();
  for (const node of stitchedNodes) {
    if (node && typeof node === "object" && "id" in node) {
      const id = String((node as any).id).toLowerCase().trim();
      const label = "label" in node ? String((node as any).label).toLowerCase().trim() : id;
      const canonical = id || label;
      if (!uniqueNodesMap.has(canonical)) {
        uniqueNodesMap.set(canonical, node);
      }
    }
  }
  stitchedNodes = Array.from(uniqueNodesMap.values());
  
  normalizeNodesWeights(stitchedNodes);
  for (const edge of stitchedEdges) {
    if (edge && typeof edge === "object" && "strength" in edge) {
      (edge as { strength: number }).strength = normalizeToTenScale(
        (edge as { strength: unknown }).strength,
      );
    }
  }`;

const newLogic = `  // Pass 1: Tally raw entity mention frequency across all chunks by canonical key
  const frequencyMap = new Map<string, number>();
  const firstOccurrenceMap = new Map<string, any>();
  const idToCanonicalMap = new Map<string, string>(); // Original ID -> canonical key

  for (const node of stitchedNodes) {
    if (node && typeof node === "object" && "id" in node) {
      const origId = String((node as any).id);
      const id = origId.toLowerCase().trim();
      const label = "label" in node ? String((node as any).label).toLowerCase().trim() : id;
      const canonical = id || label;
      
      idToCanonicalMap.set(origId, canonical);
      frequencyMap.set(canonical, (frequencyMap.get(canonical) || 0) + 1);

      if (!firstOccurrenceMap.has(canonical)) {
        // Deep copy to avoid mutating the original
        firstOccurrenceMap.set(canonical, { ...node });
      }
    }
  }

  // Pass 2: Merge duplicate nodes and apply normalizeNodeWeight
  stitchedNodes = Array.from(firstOccurrenceMap.values()).map(node => {
    const origId = String(node.id);
    const id = origId.toLowerCase().trim();
    const label = "label" in node ? String(node.label).toLowerCase().trim() : id;
    const canonical = id || label;

    const f = frequencyMap.get(canonical) || 1;
    const rawWeight = typeof node.weight === "number" ? node.weight : Number(node.weight);
    
    // Normalize weight
    node.weight = normalizeNodeWeight(f, rawWeight);
    return node;
  });
  
  // Reconcile edges so no references point to discarded duplicate IDs
  const canonicalToFirstIdMap = new Map<string, string>();
  for (const node of stitchedNodes) {
    const id = String(node.id).toLowerCase().trim();
    const label = "label" in node ? String(node.label).toLowerCase().trim() : id;
    canonicalToFirstIdMap.set(id || label, node.id);
  }

  const getReconciledId = (origId: string) => {
    const canonical = idToCanonicalMap.get(origId);
    if (!canonical) return origId;
    return canonicalToFirstIdMap.get(canonical) || origId;
  };

  for (const edge of stitchedEdges) {
    if (edge && typeof edge === "object") {
      if ("source" in edge) {
        (edge as any).source = getReconciledId(String((edge as any).source));
      }
      if ("target" in edge) {
        (edge as any).target = getReconciledId(String((edge as any).target));
      }
      if ("strength" in edge) {
        (edge as any).strength = normalizeToTenScale((edge as any).strength);
      }
    }
  }`;

content = content.replace(oldLogic, newLogic);
fs.writeFileSync(path, content);
