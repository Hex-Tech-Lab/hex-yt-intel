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
import { PERSONA_DIMENSIONS } from '@/lib/types/synthesis-nucleus';
import { KnowledgeGraphSynthesizer } from '@/lib/intelligence/knowledge-graph';
import { TfIdfSimilarityEngine } from '@/lib/intelligence/similarity';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';

const EMPTY: KnowledgeGraph = { nodes: [], edges: [], rootId: null };

// Single engine + synthesizer instance (stateless, safe to reuse).
const synthesizer = new KnowledgeGraphSynthesizer(new TfIdfSimilarityEngine());

export function useKnowledgeGraph(): { graph: KnowledgeGraph; ready: boolean } {
  const analysis = useSynthesisNucleus((s) => s.analysis);
  const activePersona = useSynthesisNucleus((s) => s.activePersona);
  const isStreaming = useSynthesisNucleus((s) => s.isStreaming);

  // Stable list of dimensions with non-trivial content.
  const dimensions = useMemo(() => {
    if (!analysis) return [];
    return Object.values(analysis.dimensions)
      .filter((d) => d && d.content && d.content.trim().length >= 40)
      .map((d) => ({ number: d.number, name: d.name, content: d.content }));
  }, [analysis]);

  // Fingerprint so we only re-synthesize when content/persona/count changes.
  const fingerprint = useMemo(
    () => `${activePersona}:${dimensions.map((d) => `${d.number}:${d.content.length}`).join('|')}`,
    [dimensions, activePersona]
  );

  const [graph, setGraph] = useState<KnowledgeGraph>(EMPTY);
  const lastFingerprint = useRef<string>('');

  useEffect(() => {
    // Need at least 2 nodes to form a relationship; don't thrash while streaming
    // unless we already have a meaningful set.
    if (dimensions.length < 2) {
      setGraph(EMPTY);
      lastFingerprint.current = '';
      return;
    }
    if (fingerprint === lastFingerprint.current) return;
    if (isStreaming && dimensions.length < 3) return;

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
  }, [fingerprint, dimensions, activePersona, isStreaming]);

  return { graph, ready: graph.nodes.length >= 2 };
}
