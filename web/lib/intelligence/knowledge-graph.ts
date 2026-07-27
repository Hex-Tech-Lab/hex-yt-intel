/**
 * KnowledgeGraphSynthesizer — builds the derived knowledge graph from a completed
 * UCIS analysis using a pluggable SimilarityEngine.
 *
 * Pipeline:
 *   1. SimilarityEngine.compute() → N×N cosine matrix + key terms
 *   2. Edge selection: top-k neighbors per node above a distribution-aware floor
 *   3. Edge classification: similar / related / tangent (by strength band),
 *      with contrarian override (topically linked but opposite polarity)
 *   4. Node weight = normalized weighted-degree centrality → root = argmax
 *
 * Isomorphic (browser + worker). Pure: no I/O, deterministic for a given engine.
 */

import type {
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  NodeIntelligence,
  RelatedRef,
  RelationKind,
  SynthesisInput,
} from '@lib/types/knowledge-graph';
import type { SimilarityEngine } from './similarity';
import { TfIdfSimilarityEngine } from './similarity';

// Compact sentiment lexicon for the contrarian heuristic. Not ground truth —
// flags "topically linked but opposite stance" as a starting signal.
const POSITIVE = new Set(
  ('strong growth opportunity success effective powerful clear valuable benefit gain ' +
    'advantage improve positive robust proven reliable trust confident optimistic ' +
    'innovative efficient quality high best win leading momentum healthy sustainable ' +
    'compelling credible authentic accurate insightful').split(/\s+/)
);
const NEGATIVE = new Set(
  ('weak risk threat failure ineffective unclear confusing flawed problem loss decline ' +
    'disadvantage worse negative fragile unproven unreliable doubt pessimistic outdated ' +
    'inefficient poor low worst lose lagging stagnant unhealthy unsustainable misleading ' +
    'dubious inauthentic inaccurate shallow concern bias contradiction overstated').split(/\s+/)
);

function polarityOf(text: string): number {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  let pos = 0;
  let neg = 0;
  for (const w of words) {
    if (POSITIVE.has(w)) pos++;
    else if (NEGATIVE.has(w)) neg++;
  }
  if (pos + neg === 0) return 0;
  return (pos - neg) / (pos + neg);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
function std(xs: number[], m: number): number {
  return xs.length ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) : 0;
}

export interface SynthesizeOptions {
  /** Max neighbors kept per node (prevents hairball). */
  topK?: number;
  /** Absolute floor below which similarity is treated as noise. */
  floor?: number;
}

export class KnowledgeGraphSynthesizer {
  private engine: SimilarityEngine;

  constructor(engine: SimilarityEngine = new TfIdfSimilarityEngine()) {
    this.engine = engine;
  }

  async synthesize(input: SynthesisInput, opts: SynthesizeOptions = {}): Promise<KnowledgeGraph> {
    const dims = [...input.dimensions].sort((a, b) => a.number - b.number);
    const n = dims.length;
    if (n === 0) return { nodes: [], edges: [], rootId: null };

    const personaSet = new Set(input.personaDimensions ?? dims.map((d) => d.number));
    const topK = opts.topK ?? 3;

    const { matrix, keyTerms } = await this.engine.compute(dims.map((d) => d.content));

    const simAt = (i: number, j: number): number => matrix[i]?.[j] ?? 0;

    // Distribution of off-diagonal similarities → adaptive thresholds
    const offDiag: number[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) offDiag.push(simAt(i, j));
    const m = mean(offDiag);
    const s = std(offDiag, m);
    const floor = opts.floor ?? Math.max(0.04, m * 0.6);
    const relatedT = m + 0.25 * s; // related band start
    const similarT = m + 1.0 * s; // near-duplicate framing

    const polarity = dims.map((d) => polarityOf(d.content));
    const polAt = (idx: number): number => polarity[idx] ?? 0;
    const idOf = (idx: number): string => `dim-${dims[idx]!.number}`;

    // Edge selection: union of each node's top-k neighbors above floor (undirected)
    const edgeMap = new Map<string, GraphEdge>();

    for (let i = 0; i < n; i++) {
      const neighbors: Array<{ j: number; sim: number }> = [];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const sim = simAt(i, j);
        if (sim >= floor) neighbors.push({ j, sim });
      }
      neighbors.sort((x, y) => y.sim - x.sim);
      for (const { j, sim } of neighbors.slice(0, topK)) {
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        const key = `${a}-${b}`;
        if (edgeMap.has(key)) continue;

        const pa = polAt(a);
        const pb = polAt(b);
        const opposed =
          Math.sign(pa) !== 0 &&
          Math.sign(pb) !== 0 &&
          Math.sign(pa) !== Math.sign(pb) &&
          Math.abs(pa - pb) >= 0.6;

        let kind: RelationKind;
        if (opposed) kind = 'contrarian';
        else if (sim >= similarT) kind = 'similar';
        else if (sim >= relatedT) kind = 'related';
        else kind = 'tangent';

        edgeMap.set(key, { source: idOf(a), target: idOf(b), strength: sim, kind });
      }
    }

    const edges = [...edgeMap.values()];

    // Weighted-degree centrality → normalized node weight
    const degree = new Array<number>(n).fill(0);
    const indexOfId = new Map(dims.map((d, idx) => [`dim-${d.number}`, idx]));
    for (const e of edges) {
      const si = indexOfId.get(e.source);
      const ti = indexOfId.get(e.target);
      if (si !== undefined) degree[si] = (degree[si] ?? 0) + e.strength;
      if (ti !== undefined) degree[ti] = (degree[ti] ?? 0) + e.strength;
    }
    const maxDeg = Math.max(...degree, 1);

    const nodes: GraphNode[] = dims.map((d, idx) => ({
      id: `dim-${d.number}`,
      dimension: d.number,
      label: d.name,
      content: d.content,
      weight: (degree[idx] ?? 0) / maxDeg,
      polarity: polAt(idx),
      keyTerms: keyTerms[idx] ?? [],
      inPersona: personaSet.has(d.number),
    }));

    let rootIdx = 0;
    for (let idx = 1; idx < n; idx++) {
      if ((degree[idx] ?? 0) > (degree[rootIdx] ?? 0)) rootIdx = idx;
    }
    const rootId = nodes.length ? `dim-${dims[rootIdx]!.number}` : null;

    return { nodes, edges, rootId };
  }
}

/**
 * Derive per-node relationship lists for the intelligence panel.
 */
export function nodeIntelligence(graph: KnowledgeGraph, nodeId: string): NodeIntelligence {
  const byId = new Map(graph.nodes.map((nd) => [nd.id, nd]));
  const ref = (otherId: string, strength: number): RelatedRef | null => {
    const nd = byId.get(otherId);
    if (!nd) return null;
    return { nodeId: nd.id, dimension: nd.dimension, label: nd.label, strength };
  };

  const buckets: Record<RelationKind, RelatedRef[]> = {
    similar: [],
    related: [],
    tangent: [],
    contrarian: [],
  };

  for (const e of graph.edges) {
    let otherId: string | null = null;
    if (e.source === nodeId) otherId = e.target;
    else if (e.target === nodeId) otherId = e.source;
    if (!otherId) continue;
    const r = ref(otherId, e.strength);
    if (r) buckets[e.kind].push(r);
  }

  for (const k of Object.keys(buckets) as RelationKind[]) {
    const seen = new Set<string>();
    buckets[k] = buckets[k]
      .filter((r) => {
        if (seen.has(r.nodeId)) return false;
        seen.add(r.nodeId);
        return true;
      })
      .sort((a, b) => b.strength - a.strength);
  }

  return {
    nodeId,
    related: buckets.related,
    similar: buckets.similar,
    tangents: buckets.tangent,
    contrarian: buckets.contrarian,
    isFoundational: graph.rootId === nodeId,
  };
}
