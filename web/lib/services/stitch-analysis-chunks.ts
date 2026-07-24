/**
 * Shared chunk-stitching logic: merges the 5 parallel bundle-stream chunk
 * payloads into a single validated analysis payload.
 *
 * SINGLE SOURCE OF TRUTH (2026-07-23): this used to live only inside
 * persist/route.ts. Extracted so the stuck-analysis reaper can reuse the
 * EXACT same stitching, KG-scale/persona-id normalization, and schema-strip-
 * retry logic when recovering an analysis whose chunks are all complete but
 * whose parent row never got finalized -- rather than reimplementing a
 * second, divergence-prone copy of the same contract. Divergent duplicate
 * implementations of this exact kind of contract is the root-cause pattern
 * behind tonight's KG-schema and persona-id incidents; this module exists
 * specifically to not repeat that mistake here.
 */
import { UCISPayloadV2Schema, KGNodeSchema, KGEdgeSchema } from '@/lib/validators/synthesis';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';
import type { DimensionStatus, BillingStatus, ValidationReportStatus } from '@/lib/types/validation-report';
import * as Sentry from '@sentry/nextjs';

export interface StitchResult {
  payload: UCISPayloadV2 | undefined;
  markdown: string;
  validationPassed: boolean;
}

/**
 * Extract dimensions from stitched payload and build status array.
 * Only uses dimensions that actually made it into the stitched content.
 */
export function extractDimensionStatus(
  stitchedPayload: UCISPayloadV2 | null | undefined
): DimensionStatus[] {
  const dimensionStatus: DimensionStatus[] = [];
  const stitchedDimensions = stitchedPayload?.dimensions || [];
  const stitchedSet = new Set(stitchedDimensions.map(d => d.number));

  for (let i = 1; i <= TOTAL_DIMENSIONS; i++) {
    if (stitchedSet.has(i)) {
      dimensionStatus.push({
        dimension: i,
        status: 'done',
        completedAt: new Date().toISOString(),
      });
    } else {
      dimensionStatus.push({
        dimension: i,
        status: 'timeout',
        error: 'Dimension not available in analysis',
      });
    }
  }

  return dimensionStatus;
}

/**
 * Build dimension status array comparing received dimensions to expected total.
 * Determines validation and billing status based on dimension completeness.
 * Billing rule (single source of truth): ONLY chargeable if 100% complete.
 */
export function buildDimensionStatus(
  stitchedPayload: UCISPayloadV2 | null | undefined
): {
  dimensionStatus: DimensionStatus[];
  validationStatus: ValidationReportStatus;
  billingStatus: BillingStatus;
  completeness: number;
} {
  const dimensionStatus = extractDimensionStatus(stitchedPayload);
  const completedCount = dimensionStatus.filter(d => d.status === 'done').length;
  const completeness = completedCount / TOTAL_DIMENSIONS;

  const billingStatus: BillingStatus = completedCount === TOTAL_DIMENSIONS ? 'completed' : 'failed';
  const validationStatus: ValidationReportStatus =
    completedCount === TOTAL_DIMENSIONS ? 'done' : completedCount > 0 ? 'partial' : 'failed';

  return { dimensionStatus, validationStatus, billingStatus, completeness };
}

/**
 * Unified stitching logic: merge chunk payloads into a single analysis payload.
 * Used by the live persist route AND the stuck-analysis reaper's recovery path.
 */
export function stitchChunksIntoPayload(
  chunkMap: Map<number, any>,
  resolvedTotal: number
): StitchResult {
  const stitchedDimensions: any[] = [];
  let stitchedPersona: any = null;
  let stitchedClassification: any = null;
  let stitchedMonetization: any = null;
  let stitchedNodes: any[] = [];
  let stitchedEdges: any[] = [];

  for (let i = 1; i <= resolvedTotal; i++) {
    const chunkPayload = chunkMap.get(i);
    if (!chunkPayload) continue;
    if (chunkPayload.dimensions && Array.isArray(chunkPayload.dimensions)) {
      stitchedDimensions.push(...chunkPayload.dimensions);
    }
    if (chunkPayload.persona && !stitchedPersona) {
      stitchedPersona = chunkPayload.persona;
    }
    if (chunkPayload.classification && !stitchedClassification) {
      stitchedClassification = chunkPayload.classification;
    }
    if (chunkPayload.monetizationVerdict && !stitchedMonetization) {
      stitchedMonetization = chunkPayload.monetizationVerdict;
    }
    if (chunkPayload.knowledgeGraph && Array.isArray(chunkPayload.knowledgeGraph.nodes)) {
      stitchedNodes.push(...chunkPayload.knowledgeGraph.nodes);
    }
    if (chunkPayload.knowledgeGraph && Array.isArray(chunkPayload.knowledgeGraph.edges)) {
      stitchedEdges.push(...chunkPayload.knowledgeGraph.edges);
    }
  }

  // Only stitch if we have dimensions to work with
  if (stitchedDimensions.length === 0) {
    return { payload: undefined, markdown: '', validationPassed: false };
  }

  const cleanDimensions = stitchedDimensions
    .filter(d => d && typeof d.number === 'number' && !isNaN(d.number))
    .sort((a, b) => a.number - b.number);

  // Normalize KG node.weight / edge.strength scale before validation.
  //
  // RCA (2026-07-23, live production test): the schema requires 1-10 (matching
  // the prompt's explicit "weight: Importance (1-10)" / "strength: Connection
  // strength (1-10)" instruction), but the model does NOT reliably follow this
  // -- the SAME model, SAME prompt, emitted 1-10 on one run and 0-1 on another
  // run of the identical video minutes apart. A strict range check alone
  // cannot fix non-deterministic LLM output; it can only reject it. Rescale
  // anything landing in the 0-1 band up onto the 1-10 scale (the model's
  // intent -- "how important is this" -- is preserved either way, just
  // expressed on a different unit), so an entire otherwise-complete 11/11
  // analysis never fails validation over a KG cosmetic-scale slip.
  const normalizeToTenScale = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return 5; // schema default-ish midpoint, never invalid
    const scaled = n > 0 && n <= 1 ? n * 10 : n;
    return Math.min(10, Math.max(1, scaled));
  };
  for (const node of stitchedNodes) {
    if (node && typeof node === 'object' && 'weight' in node) {
      (node as { weight: number }).weight = normalizeToTenScale((node as { weight: unknown }).weight);
    }
  }
  for (const edge of stitchedEdges) {
    if (edge && typeof edge === 'object' && 'strength' in edge) {
      (edge as { strength: number }).strength = normalizeToTenScale((edge as { strength: unknown }).strength);
    }
  }

  // Drop individually malformed KG nodes/edges before validation.
  //
  // RCA (2026-07-24, live production, HEX-YT-INTEL-2Z): each dimension bundle
  // independently generates its own full knowledgeGraph per the prompt's
  // "generate and include the full knowledgeGraph object" instruction, and
  // stitching simply concatenates every bundle's nodes/edges. A bundle with
  // nothing graph-worthy to contribute sometimes emits placeholder/incomplete
  // node objects (missing weight/label, invalid entityType) instead of
  // omitting the field -- one such node failed schema validation for the
  // WHOLE stitched payload, forcing billing_status='failed' on an otherwise
  // complete, valid 11/11-dimension analysis. Same "don't sink an entire
  // result over a KG cosmetic slip" philosophy as the weight-normalization
  // fix above -- filter the individually-invalid entries out rather than
  // reject everything.
  const validNodes = stitchedNodes.filter((node) => KGNodeSchema.safeParse(node).success);
  const droppedNodeCount = stitchedNodes.length - validNodes.length;
  if (droppedNodeCount > 0) {
    console.warn(`[stitch-analysis-chunks] Dropped ${droppedNodeCount} malformed KG node(s) before validation`);
  }
  const validNodeIds = new Set(validNodes.map((n) => (n as { id: unknown }).id));
  const validEdges = stitchedEdges.filter((edge) => {
    if (!KGEdgeSchema.safeParse(edge).success) return false;
    const e = edge as { source?: unknown; target?: unknown };
    // An edge referencing a node we just dropped is equally invalid.
    return validNodeIds.has(e.source) && validNodeIds.has(e.target);
  });
  const droppedEdgeCount = stitchedEdges.length - validEdges.length;
  if (droppedEdgeCount > 0) {
    console.warn(`[stitch-analysis-chunks] Dropped ${droppedEdgeCount} malformed/dangling KG edge(s) before validation`);
  }
  stitchedNodes = validNodes;
  stitchedEdges = validEdges;

  // Normalize persona id spelling before validation.
  //
  // RCA (2026-07-23, same live test): the model emitted 'content_creator' /
  // 'indie_maker' (snake_case) instead of the schema's canonical
  // 'creator' / 'indieMaker' enum -- the exact "Persona Type Mismatch"
  // finding from the 2026-07-08 Wave 0 contract audit (flagged CRITICAL /
  // IMMEDIATE priority at the time), confirmed still live and unfixed today.
  // Map known alternate spellings to the canonical id rather than reject the
  // whole analysis over a label variant the model uses interchangeably.
  const PERSONA_ID_ALIASES: Record<string, string> = {
    content_creator: 'creator',
    contentcreator: 'creator',
    indie_maker: 'indieMaker',
    indiemaker: 'indieMaker',
    product_manager: 'productManager',
    productmanager: 'productManager',
  };
  const normalizePersonaId = (id: unknown): unknown =>
    typeof id === 'string' && PERSONA_ID_ALIASES[id] ? PERSONA_ID_ALIASES[id] : id;
  if (stitchedPersona && typeof stitchedPersona === 'object') {
    for (const slot of ['primary', 'secondary', 'tertiary'] as const) {
      const entry = (stitchedPersona as Record<string, unknown>)[slot];
      if (entry && typeof entry === 'object' && 'id' in entry) {
        (entry as { id: unknown }).id = normalizePersonaId((entry as { id: unknown }).id);
      }
    }
  }

  const stitchedPayload: UCISPayloadV2 = {
    schemaVersion: '2.0',
    persona: stitchedPersona || {
      primary: { id: 'consultant', label: 'Consultant', weight: 1.0 },
      cognitiveLenses: ['default'],
      selectionRationale: 'Fallback persona — no persona data received from analysis chunks'
    },
    dimensions: cleanDimensions,
    knowledgeGraph: {
      nodes: stitchedNodes,
      edges: stitchedEdges,
      rootId: stitchedNodes[0]?.id || null
    },
    classification: stitchedClassification || {
      authoritative: false,
      practicallyActionable: false,
      knowledgeGraphReady: false,
      safe: true,
      personaOptimised: false,
      recommendation: 'conditional'
    },
    ...(stitchedMonetization ? { monetizationVerdict: stitchedMonetization } : {})
  };

  // Validate stitched payload. The schema is .strict(), but LLMs routinely emit
  // benign extra keys (e.g. persona.tier2A, edges[].relation) — strip those and
  // retry rather than throwing away an otherwise-complete analysis.
  let parseResult = UCISPayloadV2Schema.safeParse(stitchedPayload);
  for (let pass = 0; !parseResult.success && pass < 3; pass++) {
    const unrecognized = parseResult.error.issues.filter(i => i.code === 'unrecognized_keys');
    if (unrecognized.length === 0) break;
    const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
    for (const issue of unrecognized) {
      let target: any = stitchedPayload;
      for (const seg of issue.path) {
        if (FORBIDDEN_KEYS.includes(String(seg))) { target = undefined; break; }
        target = target?.[seg as any];
        if (!target) break;
      }
      if (target && typeof target === 'object') {
        for (const key of (issue as any).keys as string[]) {
          if (!FORBIDDEN_KEYS.includes(key)) delete target[key];
        }
      }
    }
    parseResult = UCISPayloadV2Schema.safeParse(stitchedPayload);
  }

  if (!parseResult.success) {
    console.error('[stitch-analysis-chunks] Stitched payload failed schema validation — preserving partial markdown', {
      dimNumbers: cleanDimensions.map(d => d.number),
      issues: parseResult.error.issues.slice(0, 10),
    });
    Sentry.captureMessage('analysis-persist: stitched payload failed schema validation (partial preserved)', {
      level: 'warning',
      tags: { operation: 'analysis-persist', phase: 'stitch_validation' },
      extra: { issues: parseResult.error.issues.slice(0, 20) },
    });
    try {
      const partialMarkdown = reconstructMarkdown(stitchedPayload);
      if (partialMarkdown && partialMarkdown.trim().length > 0) {
        return { payload: stitchedPayload, markdown: partialMarkdown, validationPassed: false };
      }
    } catch (partialErr) {
      const msg = partialErr instanceof Error ? partialErr.message : String(partialErr);
      console.error('[stitch-analysis-chunks] partial markdown reconstruction failed:', msg);
      Sentry.captureException(partialErr, { tags: { phase: 'partial_stitch' } });
    }
    const fallbackMarkdown = cleanDimensions.map((d) => `## Dimension ${d.number} ${d.name || ''}\n\n${(d.content || '').trim()}`).join('\n\n---\n\n');
    return { payload: stitchedPayload, markdown: fallbackMarkdown || `# Partial Analysis\n\n${cleanDimensions.length} dimensions recovered`, validationPassed: false };
  }

  const stitchedMarkdown = reconstructMarkdown(stitchedPayload);
  return { payload: stitchedPayload, markdown: stitchedMarkdown, validationPassed: true };
}
