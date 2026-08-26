const fs = require('fs');
const path = 'web/lib/services/stitch-analysis-chunks.ts';
let content = fs.readFileSync(path, 'utf8');

// The replacement logic:
const newLogic = `
  // Helper for consistent entity canonicalization
  function normalizeEntityKey(rawId?: unknown, rawLabel?: unknown): string {
    const key = String(rawId ?? rawLabel ?? "").trim().toLowerCase();
    return key;
  }

  // Pass 1: Tally raw entity mention frequency across all chunks by canonical key
  const frequencyMap = new Map<string, number>();
  const firstOccurrenceMap = new Map<string, Record<string, unknown>>();
  const idToCanonicalMap = new Map<string, string>(); // Original ID -> canonical key

  for (const node of stitchedNodes) {
    if (node && typeof node === "object" && "id" in node) {
      const nodeRecord = node as Record<string, unknown>;
      const nodeId = String(nodeRecord.id ?? "").trim();
      const canonicalKey = normalizeEntityKey(nodeRecord.id, nodeRecord.label);
      
      if (!canonicalKey) continue;
      
      idToCanonicalMap.set(nodeId, canonicalKey);
      frequencyMap.set(canonicalKey, (frequencyMap.get(canonicalKey) || 0) + 1);

      if (!firstOccurrenceMap.has(canonicalKey)) {
        firstOccurrenceMap.set(canonicalKey, { ...nodeRecord });
      }
    }
  }

  // Pass 2: Merge duplicate nodes and apply normalizeNodeWeight
  stitchedNodes = Array.from(firstOccurrenceMap.values()).map(nodeRecord => {
    const canonicalKey = normalizeEntityKey(nodeRecord.id, nodeRecord.label);
    const frequency = frequencyMap.get(canonicalKey) || 1;
    const rawWeight = typeof nodeRecord.weight === "number" ? nodeRecord.weight : Number(nodeRecord.weight);
    
    nodeRecord.weight = normalizeNodeWeight(frequency, rawWeight);
    return nodeRecord;
  });
  
  // Reconcile edges so no references point to discarded duplicate IDs
  const canonicalToFirstIdMap = new Map<string, string>();
  for (const node of stitchedNodes) {
    const nodeRecord = node as Record<string, unknown>;
    const canonicalKey = normalizeEntityKey(nodeRecord.id, nodeRecord.label);
    const firstId = String(nodeRecord.id ?? "").trim();
    if (canonicalKey) {
      canonicalToFirstIdMap.set(canonicalKey, firstId);
    }
  }

  const getReconciledId = (origId: unknown): string | null => {
    const stringId = String(origId ?? "").trim();
    const canonical = idToCanonicalMap.get(stringId) || normalizeEntityKey(origId);
    if (!canonical) return null;
    return canonicalToFirstIdMap.get(canonical) || stringId;
  };

  const validReconciledEdges: Record<string, unknown>[] = [];
  for (const edge of stitchedEdges) {
    if (edge && typeof edge === "object") {
      const edgeRecord = edge as Record<string, unknown>;
      
      const reconciledSource = getReconciledId(edgeRecord.source);
      const reconciledTarget = getReconciledId(edgeRecord.target);
      
      if (reconciledSource && reconciledTarget) {
        edgeRecord.source = reconciledSource;
        edgeRecord.target = reconciledTarget;
        if ("strength" in edgeRecord) {
          edgeRecord.strength = normalizeToTenScale(edgeRecord.strength);
        }
        validReconciledEdges.push(edgeRecord);
      }
    }
  }
  stitchedEdges = validReconciledEdges;`;

// Replace from "  // Pass 1: Tally raw entity mention frequency..." to "      }\n    }\n  }" (end of edge reconciliation)
const oldRegex = /  \/\/ Pass 1: Tally raw entity mention frequency[\s\S]*?(?=  \/\/ Drop individually malformed KG nodes\/edges before validation\.)/;

content = content.replace(oldRegex, newLogic + "\n\n");
fs.writeFileSync(path, content);
