/**
 * useKnowledgeGraph — derives the knowledge graph from the Synthesis Nucleus.
 *
 * The graph is a VIEW over the full analysis (all dimensions present in the raw
 * payload), recomputed only when dimension content actually changes. Persona is
 * surfaced as node.inPersona (highlight), not as a filter — the graph always shows
 * the complete knowledge structure. Synthesis runs client-side (TF-IDF) and is
 * cheap, but we still gate it to completed/near-complete analyses to avoid churning
 * on every streamed token.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { PERSONA_DIMENSIONS } from '@/lib/types/persona';
import { KnowledgeGraphSynthesizer } from '@/lib/intelligence/knowledge-graph';
import { TfIdfSimilarityEngine } from '@/lib/intelligence/similarity';
import type { KnowledgeGraph, GraphNode, GraphEdge, RelationKind } from '@/lib/types/knowledge-graph';

const EMPTY: KnowledgeGraph = { nodes: [], edges: [], rootId: null };

// Default dimension used for knowledge-graph extraction fallback (Dimension 8)
const DEFAULT_KG_EXTRACTION_DIMENSION = 8;

// Single engine + synthesizer instance (stateless, safe to reuse).
const synthesizer = new KnowledgeGraphSynthesizer(new TfIdfSimilarityEngine());

export function useKnowledgeGraph(analysisId?: string | null): { graph: KnowledgeGraph; ready: boolean; loading: boolean } {
  const analysis = useSynthesisNucleus((s) => s.analysis);
  const activePersona = useSynthesisNucleus((s) => s.activePersona);
  const storeKnowledgeGraph = useSynthesisNucleus((s) => s.knowledgeGraph);
  const [loading, setLoading] = useState(false);
  const [loadedFromApi, setLoadedFromApi] = useState(false);

  // Stable list of dimensions with non-trivial content.
  const dimensions = useMemo(() => {
    if (!analysis) return [];
    const validDims: Array<{ number: number; name: string; content: string }> = [];
    for (const dItem of Object.values(analysis.dimensions)) {
      if (dItem && dItem.content && dItem.content.trim().length >= 12) {
        validDims.push({ number: dItem.number, name: dItem.name, content: dItem.content });
      }
    }
    return validDims;
  }, [analysis]);

  // Fingerprint so we only re-synthesize when content/persona/count changes.
  // Post-review finding (2026-08-06): must include analysisId. Without it,
  // switching from analysis A to analysis B with the SAME persona and
  // coincidentally identical per-dimension content LENGTHS (fingerprint
  // compares lengths, not content) -- and B's API returning empty/error, so
  // loadedFromApi stays false -- would match lastFingerprint and skip
  // re-synthesis entirely, leaving A's stale graph displayed for B.
  const fingerprint = useMemo(
    () => `${analysisId}:${activePersona}:${dimensions.map((d) => `${d.number}:${d.content.length}`).join('|')}`,
    [analysisId, dimensions, activePersona]
  );

  const [graph, setGraph] = useState<KnowledgeGraph>(EMPTY);
  const lastFingerprint = useRef<string>('');

  // 1. API Fetching (if analysisId exists)
  useEffect(() => {
    if (!analysisId) {
      setGraph(EMPTY);
      setLoadedFromApi(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadedFromApi(false);
    fetch(`/api/analyses/${analysisId}/graph`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const nodes = (data.entities || []).map((e: any) => ({
          id: e.id,
          label: e.label,
          type: e.type,
          entityType: e.type || 'concept',
          weight: e.weight
        }));
        const nodeIds = new Set(nodes.map((n: any) => String(n.id)));
        const edges: Array<{ source: string; target: string; strength: number; kind: RelationKind }> = [];
        for (const rItem of (data.relations || [])) {
          if (rItem && nodeIds.has(String(rItem.source_entity_id)) && nodeIds.has(String(rItem.target_entity_id))) {
            edges.push({
              source: String(rItem.source_entity_id),
              target: String(rItem.target_entity_id),
              strength: typeof rItem.strength === 'number' ? rItem.strength : 1,
              kind: rItem.kind || 'related'
            });
          }
        }
        
        if (nodes.length > 0) {
          setGraph({
            nodes,
            edges,
            rootId: null
          });
          setLoadedFromApi(true);
        } else {
          // Empty API result: do NOT setGraph(EMPTY) here. The
          // /api/analyses/[id]/graph route is backed by the kg_entities /
          // kg_relations tables, which are empty database-wide for exactly the
          // "no knowledge graph anywhere" analyses the client-side fallback
          // exists to render (ADR 023). Overwriting with EMPTY here would
          // clobber a just-synthesized fallback graph, so on an empty result
          // we leave whatever the fallback produced in place and only clear
          // the `loadedFromApi` flag. The graph is fully cleared on analysis
          // switch / null analysisId in the `if (!analysisId)` branch and in
          // the fallback's own empty-dimensions branch.
          setLoadedFromApi(false);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          // On a fetch error, do not wipe a synthesized fallback graph either.
          setLoadedFromApi(false);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [analysisId]);

  // 2. Client-side Synthesis (fallback/live)
  useEffect(() => {
    // If we have a high-fidelity knowledge graph generated by the worker, validate and use it directly!
    if (storeKnowledgeGraph && Array.isArray(storeKnowledgeGraph.nodes) && storeKnowledgeGraph.nodes.length > 0) {
      // Validate and map nodes in a single flatMap pass
      const mappedNodes: GraphNode[] = storeKnowledgeGraph.nodes.flatMap((n: any) => {
        if (!n || (typeof n.id !== 'string' && typeof n.id !== 'number') || typeof n.label !== 'string') {
          return [];
        }
        return [{
          id: String(n.id),
          dimension: typeof n.dimension === 'number' ? n.dimension : DEFAULT_KG_EXTRACTION_DIMENSION,
          label: n.label,
          content: n.content || '',
          weight: typeof n.weight === 'number' ? n.weight : 1,
          polarity: typeof n.polarity === 'number' ? n.polarity : 0,
          keyTerms: Array.isArray(n.keyTerms) ? n.keyTerms : [],
          inPersona: typeof n.inPersona === 'boolean' ? n.inPersona : true,
          entityType: n.entityType || n.type || 'concept',
        }];
      });

      if (mappedNodes.length > 0) {
        const nodeIds = new Set(mappedNodes.map((n) => n.id));

        // Validate and map edges in a single flatMap pass
        const rawEdges = Array.isArray(storeKnowledgeGraph.edges) ? storeKnowledgeGraph.edges : [];
        const mappedEdges: GraphEdge[] = rawEdges.flatMap((e: any) => {
          if (
            !e ||
            (typeof e.source !== 'string' && typeof e.source !== 'number') ||
            (typeof e.target !== 'string' && typeof e.target !== 'number') ||
            !nodeIds.has(String(e.source)) ||
            !nodeIds.has(String(e.target))
          ) {
            return [];
          }
          return [{
            source: String(e.source),
            target: String(e.target),
            strength: typeof e.strength === 'number' ? e.strength : 1,
            kind: e.kind || 'related',
          }];
        });

        // Derive rootId: use storeKnowledgeGraph.rootId if valid, else derive from the first valid mapped node
        let resolvedRootId = storeKnowledgeGraph.rootId;

        if (!resolvedRootId || !nodeIds.has(resolvedRootId)) {
          resolvedRootId = mappedNodes[0]?.id || null;
        }

        setGraph({
          nodes: mappedNodes,
          edges: mappedEdges,
          rootId: resolvedRootId,
        });
        return;
      }
    }

    // If a real graph came back from the API (kg_entities), it wins -- don't
    // overwrite it with the synthesized fallback.
    if (loadedFromApi) return;

    if (dimensions.length < 1) {
      setGraph(EMPTY);
      lastFingerprint.current = '';
      return;
    }
    if (fingerprint === lastFingerprint.current) return;

    let cancelled = false;
    synthesizer
      .synthesize({ dimensions, personaDimensions: PERSONA_DIMENSIONS[activePersona] })
      .then((g) => {
        if (cancelled) return;
        lastFingerprint.current = fingerprint;
        setGraph(g);
      })
      .catch(() => {
        if (!cancelled) setGraph(EMPTY);
      });

    return () => {
      cancelled = true;
    };
  }, [fingerprint, dimensions, activePersona, analysisId, loadedFromApi, storeKnowledgeGraph]);

  return { graph, ready: graph.nodes.length >= 1, loading };
}
