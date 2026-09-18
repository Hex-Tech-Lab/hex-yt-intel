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
import * as Sentry from '@sentry/nextjs';
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { PERSONA_DIMENSIONS } from '@/lib/types/persona';
import { KnowledgeGraphSynthesizer } from '@/lib/intelligence/knowledge-graph';
import { TfIdfSimilarityEngine } from '@/lib/intelligence/similarity';
import { normalizeEntityType } from '@/lib/design/entity-taxonomy';
import type { KnowledgeGraph, GraphNode, GraphEdge } from '@/lib/types/knowledge-graph';

const EMPTY: KnowledgeGraph = { nodes: [], edges: [], rootId: null };

// Default dimension used for knowledge-graph extraction fallback (Dimension 8)
const DEFAULT_KG_EXTRACTION_DIMENSION = 8;

// Bounded retry budget for the /graph fetch (2026-09-15, incident video
// rDhaCLrdWHk): the fetch previously ran exactly once per analysisId — a
// network drop or a transient 5xx left the graph permanently empty for the
// session (WordCloud panel never rendered for ADR 023-style rows with no
// worker-provided knowledgeGraph), with the failure swallowed silently.
// 3 attempts at 5s/10s spacing, plus a re-arm on each offline->online
// transition (bounded by real network events, not a poll loop). 4xx
// (401/404) are permanent by nature and never retried within the budget.
// PR #313 post-merge review (2026-09-15): network-level rejections
// (fetch throwing TypeError: Failed to fetch on a dropped connection — the
// incident's exact failure mode) and timeout aborts (fetchWithTimeout below,
// covering a stalled connection that never settles) now share this SAME
// bounded budget with 5xx responses — previously only a 5xx response entered
// the schedule; a rejected fetch skipped straight to the online-event last
// resort, and a stalled-but-never-settling fetch hung forever outside it.
const MAX_GRAPH_FETCH_RETRIES = 3;
const GRAPH_RETRY_BASE_DELAY_MS = 5000;

// Single engine + synthesizer instance (stateless, safe to reuse).
const synthesizer = new KnowledgeGraphSynthesizer(new TfIdfSimilarityEngine());

// --- Pure /graph payload mapping helpers (PR #315 review round 2, items
// 2+6, 2026-09-18) — module-level so they are individually testable and
// fetchGraph's cyclomatic complexity stays under DeepSource's threshold.
// Behavior contract: any INVALID ITEM (not just a wrong top-level shape)
// rejects the WHOLE payload with a thrown error, which the fetch driver
// classifies as retryable — items are never silently dropped or mapped
// with undefined ids, which used to poison the nodeIds set every
// downstream consumer derives from. ---

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isValidEntityId = (value: unknown): value is string | number =>
  (typeof value === 'string' && value.trim().length > 0) || isFiniteNumber(value);

function throwMalformed(detail: string): never {
  throw new Error(`graph fetch failed: malformed payload (${detail})`);
}

interface RawEntityFields {
  id?: unknown;
  dimension?: unknown;
  raw_node?: { dimension?: unknown } | null;
  weight?: unknown;
}

// Resolves an entity's dimension, preserving the established precedence
// (raw_node.dimension > dimension > DEFAULT sentinel). Any PRESENT value
// must be a finite number — `typeof NaN === 'number'` used to slip a NaN
// through the old typeof check into node.dimension.
const resolveEntityDimension = (entity: RawEntityFields): number => {
  const rawDimension = entity.raw_node?.dimension;
  if (isFiniteNumber(rawDimension)) return rawDimension;
  if (isFiniteNumber(entity.dimension)) return entity.dimension;
  // A PRESENT-but-non-finite value (e.g. NaN, which passes a bare
  // typeof-number check) rejects the payload; absence keeps the sentinel.
  if (rawDimension !== undefined || entity.dimension !== undefined) {
    throwMalformed('entity dimension is not a finite number');
  }
  return DEFAULT_KG_EXTRACTION_DIMENSION;
};

const mapEntityToNode = (entity: unknown): GraphNode => {
  if (!entity || typeof entity !== 'object') throwMalformed('entity is not an object');
  const e = entity as RawEntityFields & { label?: unknown; type?: string };
  if (!isValidEntityId(e.id)) throwMalformed('entity has a missing/invalid id');
  if (e.weight !== undefined && !isFiniteNumber(e.weight)) throwMalformed('entity weight is not a finite number');
  // API-sourced nodes carry only id/dimension/label/type/entityType/weight
  // (kg_entities has no content/polarity/keyTerms/inPersona columns). An
  // absent weight defaults to 1 — the same default the client-side fallback
  // path (section 2 below) and edges' strength default use.
  return {
    id: e.id,
    dimension: resolveEntityDimension(e),
    label: e.label,
    type: e.type,
    entityType: normalizeEntityType(e.type),
    weight: isFiniteNumber(e.weight) ? e.weight : 1,
  } as unknown as GraphNode;
};

const mapRelationsToEdges = (relations: unknown[], nodes: GraphNode[]): GraphEdge[] => {
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  return relations.map((rawRelation): GraphEdge => {
    if (!rawRelation || typeof rawRelation !== 'object') throwMalformed('relation is not an object');
    const relation = rawRelation as { source_entity_id?: unknown; target_entity_id?: unknown; strength?: unknown; kind?: unknown };
    // An endpoint that does not reference a real mapped node id rejects the
    // whole payload (previously the relation was silently dropped).
    if (relation.source_entity_id == null || relation.target_entity_id == null ||
        !nodeIds.has(String(relation.source_entity_id)) || !nodeIds.has(String(relation.target_entity_id))) {
      throwMalformed('relation references an unknown entity id');
    }
    if (relation.strength !== undefined && !isFiniteNumber(relation.strength)) throwMalformed('relation strength is not a finite number');
    return {
      source: String(relation.source_entity_id),
      target: String(relation.target_entity_id),
      strength: isFiniteNumber(relation.strength) ? relation.strength : 1,
      kind: (typeof relation.kind === 'string' && relation.kind ? relation.kind : 'related') as GraphEdge['kind'],
    };
  });
};

// Validates the top-level payload shape AND maps every item, throwing on
// the first invalid item (whole-payload rejection, never a partial graph).
// Returns null only for a genuinely EMPTY graph (entities: []) — a distinct
// success outcome the caller uses to keep its synthesized fallback in place.
export const mapGraphPayload = (data: unknown): { nodes: GraphNode[]; edges: GraphEdge[] } | null => {
  if (!data || typeof data !== 'object') throwMalformed('not an object');
  const record = data as { entities?: unknown; relations?: unknown };
  const entities = Array.isArray(record.entities) ? record.entities : null;
  const relations = Array.isArray(record.relations) ? record.relations : null;
  if (!entities || !relations) {
    // Valid JSON but wrong shape — retryable (P0-2), not a silent
    // "empty result". A half-truncated 200 body that parses as JSON
    // but drops the entities/relations arrays is a transient failure.
    throwMalformed('entities or relations not an array');
  }
  const nodes = entities.map(mapEntityToNode);
  if (nodes.length === 0) return null;
  return { nodes, edges: mapRelationsToEdges(relations, nodes) };
};

// Classifies a thrown error from the fetch+consume pipeline into
// 'retryable' (network/timeout/5xx/malformed-body — re-attempt on the
// bounded schedule) vs 'permanent' (any 4xx — settle, never re-arm).
// A 4xx carries its status on the thrown error (see buildHttpError);
// everything else is retryable by default.
export const classifyFailure = (error: unknown): 'retryable' | 'permanent' => {
  const status = (error as { status?: unknown })?.status;
  if (isFiniteNumber(status) && status >= 400 && status < 500) return 'permanent';
  return 'retryable';
};

const buildHttpError = (response: Response): Error & { status: number } => {
  // 5xx throws here too (retryable via classifyFailure); a 4xx throws
  // with its status so classifyFailure marks it permanent.
  const error = new Error(`graph fetch failed: HTTP ${response.status}`) as Error & { status: number };
  error.status = response.status;
  return error;
};

export function useKnowledgeGraph(analysisId?: string | null, enabled: boolean = true): { graph: KnowledgeGraph; ready: boolean; loading: boolean } {
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
    if (!analysisId || !enabled) { // Gated by enabled flag
      setGraph(EMPTY);
      setLoadedFromApi(false);
      return;
    }

    let cancelled = false;
    let lastAttemptFailed = false;

    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    // PR #313 post-merge review (2026-09-15): ONE bounded retry driver for
    // every retryable failure class. A network-level rejection (dropped
    // connection), a timeout abort (stalled connection), a 5xx response, AND
    // a malformed/invalid 200 body (P0-2 + round-2 deep validation) all
    // route through the same backoff schedule below. 4xx is permanent
    // (auth/ownership/not-found): fails immediately, no budget spent, and
    // does NOT arm the online-event recovery (P0-3 — previously 4xx set
    // lastAttemptFailed=true, so every later connectivity transition
    // re-fetched a 401/404 that never succeeds). Payload validation and
    // failure classification are the module-level pure helpers above (P1-4
    // refactor, complexity under DeepSource's threshold; behavior preserved
    // except the round-2 whole-payload item validation).
    const consumeGraphResponse = async (response: Response): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] } | null> => {
      if (!response.ok) throw buildHttpError(response);
      // Let res.json() throw naturally on invalid JSON — the outer catch
      // logs it and classifies it as retryable (any non-4xx error is
      // retryable by default). No inner catch needed: the raw parse error
      // message is descriptive enough ("Unexpected token..." etc.) and the
      // outer catch already captures it.
      const data = await response.json();
      if (cancelled) throw new Error('__cancelled__');
      // mapGraphPayload validates the shape AND every entity/relation item,
      // throwing on the first invalid item (whole-payload rejection).
      return mapGraphPayload(data);
    };

    const fetchGraph = async (attempt = 0): Promise<void> => {
      setLoading(true);
      setLoadedFromApi(false);
      try {
        // fetchWithTimeout (P0-1/P0b): the consumeResponse callback runs
        // INSIDE the timeout window, so a stalled `.json()` (headers arrive
        // but body never completes) is aborted on the same schedule a
        // stalled connection is — the timer is not cleared until
        // consumeResponse settles. A non-ok response, an invalid JSON body,
        // and a valid-JSON-but-malformed shape all throw here and propagate
        // to the catch below (P0-2: previously parse/mapping ran OUTSIDE
        // try/catch, so a thrown parse error was an unhandled rejection —
        // `loading` never settled, no retry scheduled, no error surfaced).
        const mapped = await fetchWithTimeout(
          `/api/analyses/${encodeURIComponent(analysisId)}/graph`,
          undefined,
          consumeGraphResponse
        );

        if (cancelled) return;
        // Success — including an empty-body success: clear the failure flag
        // so a later 'online' event cannot re-fire a redundant fetch (P1a).
        // Do NOT clear lastAttemptFailed until the body has been parsed AND
        // accepted as valid (P0-2).
        lastAttemptFailed = false;
        if (mapped) {
          setGraph({ nodes: mapped.nodes, edges: mapped.edges, rootId: null });
          setLoadedFromApi(true);
        } else {
          // Empty API result: do NOT setGraph(EMPTY) here — would clobber a
          // just-synthesized fallback graph (ADR 023). Only clear the flag.
          setLoadedFromApi(false);
        }
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        const classification = classifyFailure(error);
        if (classification === 'permanent') {
          // 4xx (P0-3): settle loading, mark non-retryable, and leave
          // lastAttemptFailed = false so the online listener does NOT
          // re-arm. Previously 4xx set the flag true, re-arming forever.
          lastAttemptFailed = false;
          console.warn('[useKnowledgeGraph] graph fetch permanent failure:', error instanceof Error ? error.message : String(error));
          setLoadedFromApi(false);
          setLoading(false);
          return;
        }
        // Retryable (network/timeout/5xx/malformed body): re-attempt on the
        // bounded schedule, or surface failure on exhaustion.
        if (attempt < MAX_GRAPH_FETCH_RETRIES) {
          await wait(GRAPH_RETRY_BASE_DELAY_MS * (attempt + 1));
          if (cancelled) return;
          await fetchGraph(attempt + 1);
          return;
        }
        lastAttemptFailed = true;
        console.warn('[useKnowledgeGraph] graph fetch failed (retryable, exhausted):', error instanceof Error ? error.message : String(error));
        Sentry.captureException(error, { contexts: { useKnowledgeGraph: { analysisId, attempt } } });
        setLoadedFromApi(false);
        setLoading(false);
      }
    };

    void fetchGraph();

    // Recovery re-arm on offline->online (2026-09-15, incident video
    // rDhaCLrdWHk): covers the outage case where ALL bounded retries ran
    // while the connection was still down. Bounded by real network events,
    // not a poll loop; skipped entirely when the last attempt succeeded.
    const attemptRecovery = () => {
      if (cancelled || !lastAttemptFailed) return;
      void fetchGraph();
    };
    window.addEventListener('online', attemptRecovery);

    return () => {
      cancelled = true;
      window.removeEventListener('online', attemptRecovery);
    };
  }, [analysisId, enabled]);

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
          // ROOT CAUSE of PR #239's remaining gray-WordCloud gap: this is the
          // client-state path fed directly by the worker's live SSE stream
          // (ADR 023 fallback + fresh in-progress analyses), which carries
          // the worker's raw legacy lowercase 8-value enum
          // (concept/framework/tool/study/trend/metric/...), never the
          // persisted/normalized POLE+O value. entity-colors.ts does an exact
          // Record lookup with no legacy-alias handling, so every one of
          // those unnormalized values fell through to the gray default --
          // reproducing on a real fresh analysis even with #239's fix
          // otherwise applied. Normalize here, at the same hook boundary
          // used by the API-sourced branch above, so every consumer
          // (WordCloud/MindMap/KnowledgeGraphCanvas) always receives POLE+O.
          entityType: normalizeEntityType(n.entityType || n.type),
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
