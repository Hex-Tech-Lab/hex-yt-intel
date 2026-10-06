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
import * as Sentry from "@sentry/nextjs";

import { TOTAL_DIMENSIONS } from "@/lib/config/synthesis";
import { normalizeEntityType } from "@/lib/design/entity-taxonomy";
import { reconstructMarkdown } from "@/lib/utils/markdown-reconstructor";
import { normalizeNodeWeight } from "@/lib/utils/node-weight-normalization";
import { CombinerPass } from "@/lib/services/CombinerPass";
import {
  UCISPayloadV2Schema,
  KGNodeSchema,
  KGEdgeSchema,
  MAX_KG_NODES,
  MAX_KG_EDGES,
  normalizePersonaId,
} from "@/lib/validators/synthesis";

import type { UCISPayloadV2 } from "@/lib/types/synthesis-nucleus";
import type {
  DimensionStatus,
  BillingStatus,
  ValidationReportStatus,
} from "@/lib/types/validation-report";

export interface StitchResult {
  payload: UCISPayloadV2 | undefined;
  markdown: string;
  validationPassed: boolean;
}

/**
 * Type guard for "does this unknown DB JSONB payload have a usable `dimensions`
 * array shape?" — implementation + full RCA doc live in
 * `@/lib/utils/has-usable-dimensions-payload` (moved out of this file, PR #314
 * second review round, to keep this module under the 500-line qa-intel
 * monolith-file gate). Re-exported here so the route's existing import keeps
 * working unchanged.
 */
export { hasUsableDimensionsPayload } from '@/lib/utils/has-usable-dimensions-payload';

/**
 * Extract dimensions from stitched payload and build status array.
 * Only uses dimensions that actually made it into the stitched content.
 */
export function extractDimensionStatus(
  stitchedPayload: UCISPayloadV2 | null | undefined,
): DimensionStatus[] {
  const dimensionStatus: DimensionStatus[] = [];
  const stitchedDimensions = stitchedPayload?.dimensions || [];
  const stitchedSet = new Set(stitchedDimensions.map((d) => d.number));

  for (let i = 1; i <= TOTAL_DIMENSIONS; i++) {
    if (stitchedSet.has(i)) {
      dimensionStatus.push({
        dimension: i,
        status: "done",
        completedAt: new Date().toISOString(),
      });
    } else {
      dimensionStatus.push({
        dimension: i,
        status: "timeout",
        error: "Dimension not available in analysis",
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
  stitchedPayload: UCISPayloadV2 | null | undefined,
): {
  dimensionStatus: DimensionStatus[];
  validationStatus: ValidationReportStatus;
  billingStatus: BillingStatus;
  completeness: number;
} {
  const dimensionStatus = extractDimensionStatus(stitchedPayload);
  const completedCount = dimensionStatus.filter(
    (d) => d.status === "done",
  ).length;
  const completeness = completedCount / TOTAL_DIMENSIONS;

  const billingStatus: BillingStatus =
    completedCount === TOTAL_DIMENSIONS ? "completed" : "failed";
  const validationStatus: ValidationReportStatus =
    completedCount === TOTAL_DIMENSIONS
      ? "done"
      : completedCount > 0
        ? "partial"
        : "failed";

  return { dimensionStatus, validationStatus, billingStatus, completeness };
}


/**
 * Resolve the final billing_status for a persisted analysis row — moved to
 * `@/lib/services/billing-status.ts` (PR #314 second review round, keeps this
 * module under the 500-line qa-intel monolith-file gate). Re-exported so the
 * route's existing import keeps working unchanged.
 */
export { resolveBillingStatus } from '@/lib/services/billing-status';

/**
 * Cap the Cross-Domain Bridges markdown at the registry-resolved max. Display
 * text, not a security boundary — truncation appends a visible marker so the
 * cut is never silent. Default 4000 matches the registry key's default
 * (analysis.layer2.crossDomainBridgesMaxChars).
 */
export const CROSS_DOMAIN_BRIDGES_DEFAULT_MAX_CHARS = 4000;
const BRIDGES_HEADING = "#### 8.3 Cross-Domain Bridges";
// R1e: same heading style for the 8.4 Discovery Pathways section.
const PATHWAYS_HEADING = "#### 8.4 Discovery Pathways";

export function truncateBridges(markdown: string, maxChars?: number): string {
  const cap = typeof maxChars === "number" && Number.isFinite(maxChars) && maxChars > 0
    ? Math.floor(maxChars)
    : CROSS_DOMAIN_BRIDGES_DEFAULT_MAX_CHARS;
  if (markdown.length <= cap) return markdown;
  console.warn(
    "[stitch-analysis-chunks] crossDomainBridges exceeded cap — truncating",
    { cap, actual: markdown.length },
  );
  return `${markdown.slice(0, cap)}\n\n_(truncated at ${cap} characters — analysis.layer2.crossDomainBridgesMaxChars)_`;
}

/**
 * Unified stitching logic: merge chunk payloads into a single analysis payload.
 * Used by the live persist route AND the stuck-analysis reaper's recovery path.
 */
export function stitchChunksIntoPayload(
  chunkMap: Map<number, any>,
  resolvedTotal: number,
  extraMetadata?: { videoMetadata?: any; channelMeta?: any; comments?: any; stance_relations?: any },
  crossDomainBridgesMaxChars?: number,
): StitchResult {
  const stitchedDimensions: any[] = [];
  let stitchedPersona: any = null;
  let stitchedClassification: any = null;
  let stitchedMonetization: any = null;
  let stitchedStanceRelations: any = null;
  let stitchedCrossDomainBridges: string | null = null;
  // R1e (2026-09-29): 8.4 Discovery Pathways markdown from the projective
  // bundle's root field. The grounded bundle's `explicitSpeakerResources`
  // intermediate needs no capture — it is simply deleted from the stitched
  // payload below so it never persists.
  let stitchedDiscoveryPathways: string | null = null;
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
    if (chunkPayload.stance_relations && !stitchedStanceRelations) {
      stitchedStanceRelations = chunkPayload.stance_relations;
    }
    // R1b (2026-09-29): sub-dimension 8.3 Cross-Domain Bridges arrives as a
    // top-level root field on the projective bundle's payload (it belongs to
    // no emitted dimension object). First non-empty wins, mirroring the
    // monetizationVerdict precedent above.
    if (
      typeof chunkPayload.crossDomainBridges === "string" &&
      chunkPayload.crossDomainBridges.trim().length > 0 &&
      !stitchedCrossDomainBridges
    ) {
      stitchedCrossDomainBridges = chunkPayload.crossDomainBridges;
    }
    // R1e (2026-09-29): same first-non-empty-wins pattern for the 8.4
    // Discovery Pathways markdown root field (projective bundle).
    if (
      typeof chunkPayload.discoveryPathways === "string" &&
      chunkPayload.discoveryPathways.trim().length > 0 &&
      !stitchedDiscoveryPathways
    ) {
      stitchedDiscoveryPathways = chunkPayload.discoveryPathways;
    }
    if (
      chunkPayload.knowledgeGraph &&
      Array.isArray(chunkPayload.knowledgeGraph.nodes)
    ) {
      // Normalize to POLE+O at the write boundary -- see entity-taxonomy.ts.
      // All other node fields pass through unchanged; only entityType (the
      // field color/UI code reads) is overwritten to the canonical value.
      stitchedNodes.push(
        ...chunkPayload.knowledgeGraph.nodes.map((node: any) => ({
          ...node,
          entityType: normalizeEntityType(node.entityType ?? node.type),
        })),
      );
    }
    if (
      chunkPayload.knowledgeGraph &&
      Array.isArray(chunkPayload.knowledgeGraph.edges)
    ) {
      stitchedEdges.push(...chunkPayload.knowledgeGraph.edges);
    }
  }

  // Only stitch if we have dimensions to work with
  if (stitchedDimensions.length === 0) {
    return { payload: undefined, markdown: "", validationPassed: false };
  }

  const cleanDimensions = CombinerPass.reduceDimensions(
    stitchedDimensions
      .filter((d) => d && typeof d.number === "number" && !isNaN(d.number))
  ).sort((a, b) => a.number - b.number);

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
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return 5; // schema default-ish midpoint, never invalid
    const scaled = n > 0 && n <= 1 ? n * 10 : n;
    return Math.min(10, Math.max(1, scaled));
  };

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
  stitchedEdges = validReconciledEdges;

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
  const validNodes = stitchedNodes.map(node => {
    const res = KGNodeSchema.safeParse(node);
    if (!res.success) {
      console.warn('[stitch-analysis-chunks] Schema validation dropped entity', res.error.issues);
      Sentry.captureMessage(`Validation dropped payload at ${'stitch-analysis-chunks (node)'}`, {
          level: "warning",
          extra: {
            boundary: 'stitch-analysis-chunks (node)',
            issueCount: res.error.issues.length,
            issuePaths: res.error.issues.map((i: any) => `${i.path.join(".")}: ${i.code}`),
          },
        });
      return null;
    }
    return res.data;
  }).filter((n): n is NonNullable<typeof n> => n !== null);
  const droppedNodeCount = stitchedNodes.length - validNodes.length;
  if (droppedNodeCount > 0) {
    console.warn(
      `[stitch-analysis-chunks] Dropped ${droppedNodeCount} malformed KG node(s) before validation`,
    );
  }
  const validNodeIds = new Set(
    validNodes.map((n) => (n as { id: unknown }).id),
  );
  let danglingEdgesCount = 0;
  const validEdges = stitchedEdges.map(edge => {
    const edgeRes = KGEdgeSchema.safeParse(edge);
    if (!edgeRes.success) {
      console.warn('[stitch-analysis-chunks] Schema validation dropped edge', edgeRes.error.issues);
      Sentry.captureMessage(`Validation dropped payload at ${'stitch-analysis-chunks (edge)'}`, {
          level: "warning",
          extra: {
            boundary: 'stitch-analysis-chunks (edge)',
            issueCount: edgeRes.error.issues.length,
            issuePaths: edgeRes.error.issues.map((i: any) => `${i.path.join(".")}: ${i.code}`),
          },
        });
      return null;
    }
    const e = edgeRes.data;
    if (!validNodeIds.has(e.source) || !validNodeIds.has(e.target)) {
      danglingEdgesCount++;
      return null;
    }
    return e;
  }).filter((e): e is NonNullable<typeof e> => e !== null);

  if (danglingEdgesCount > 0) {
    console.warn(`[stitch-analysis-chunks] Dropped ${danglingEdgesCount} dangling edges missing node endpoints`);
    Sentry.captureMessage('stitch-analysis-chunks: dropped dangling edges', { level: 'warning', extra: { danglingEdgesCount } });
  }
  const droppedEdgeCount = stitchedEdges.length - validEdges.length;
  if (droppedEdgeCount > 0) {
    console.warn(
      `[stitch-analysis-chunks] Dropped ${droppedEdgeCount} malformed/dangling KG edge(s) before validation`,
    );
  }
  stitchedNodes = validNodes.slice(0, MAX_KG_NODES);
  stitchedEdges = validEdges.slice(0, MAX_KG_EDGES);

  // Normalize persona id spelling before validation.
  //
  // RCA (2026-07-23, same live test): the model emitted 'content_creator' /
  // 'indie_maker' (snake_case) instead of the schema's canonical
  // 'creator' / 'indieMaker' enum -- the exact "Persona Type Mismatch"
  // finding from the 2026-07-08 Wave 0 contract audit (flagged CRITICAL /
  // IMMEDIATE priority at the time), confirmed still live and unfixed today.
  // Map known alternate spellings to the canonical id rather than reject the
  // whole analysis over a label variant the model uses interchangeably.
  if (stitchedPersona && typeof stitchedPersona === "object") {
    for (const slot of ["primary", "secondary", "tertiary"] as const) {
      const entry = (stitchedPersona as Record<string, unknown>)[slot];
      if (entry && typeof entry === "object" && "id" in entry) {
        (entry as { id: unknown }).id = normalizePersonaId(
          (entry as { id: unknown }).id,
        );
      }
    }
  }

  const stitchedPayload: UCISPayloadV2 = {
    schemaVersion: "2.0",
    persona: stitchedPersona || {
      primary: { id: "consultant", label: "Consultant", weight: 1.0 },
      cognitiveLenses: ["default"],
      selectionRationale:
        "Fallback persona — no persona data received from analysis chunks",
    },
    dimensions: cleanDimensions,
    knowledgeGraph: {
      nodes: stitchedNodes,
      edges: stitchedEdges,
      rootId: stitchedNodes[0]?.id || null,
    },
    classification: stitchedClassification || {
      authoritative: false,
      practicallyActionable: false,
      knowledgeGraphReady: false,
      safe: true,
      personaOptimised: false,
      recommendation: "conditional",
    },
    ...(stitchedMonetization
      ? { monetizationVerdict: stitchedMonetization }
      : {}),
    // R1b (2026-09-29): stitch sub-dimension 8.3 Cross-Domain Bridges back
    // into dimension 8's content (the projective bundle carries it as a
    // top-level root field because it belongs to no emitted dimension
    // object). Appended after 8.2/before 8.4 is NOT attempted — the content
    // is appended at the end of dim 8's markdown so the grounded bundle's
    // output is never reordered. Capped at
    // analysis.layer2.crossDomainBridgesMaxChars (code fallback 4000);
    // over-cap is truncated with a logged warning — display text, not a
    // security boundary.
    ...(extraMetadata?.videoMetadata
      ? { videoMetadata: extraMetadata.videoMetadata }
      : {}),
    ...(extraMetadata?.channelMeta
      ? { channelMeta: extraMetadata.channelMeta }
      : {}),
    ...(extraMetadata?.comments ? { comments: extraMetadata.comments } : {}),
    ...(stitchedStanceRelations || extraMetadata?.stance_relations
      ? { stance_relations: stitchedStanceRelations || extraMetadata?.stance_relations }
      : {}),
  };

  // R1e (2026-09-29): strip the `explicitSpeakerResources` intermediate. It
  // exists only as grounded→projective handoff input and must NOT survive
  // into the persisted payload.
  delete stitchedPayload.explicitSpeakerResources;

  // R1b (2026-09-29): append the stitched Cross-Domain Bridges markdown into
  // dimension 8's content so it renders inside the Semantic Foundation card
  // (dim 8 is grounded and its grounded bundle was told to OMIT 8.3). The
  // grounded content is never reordered — bridges append at the end.
  // R1e (2026-09-29): 8.4 Discovery Pathways (projective root field
  // `discoveryPathways`) is appended AFTER 8.3 the same way, reusing the
  // same cap key (analysis.layer2.crossDomainBridgesMaxChars). Order is
  // 8.1 → 8.2 → 8.3 → 8.4. The intermediate `explicitSpeakerResources`
  // root field is stripped — it must NOT survive into the persisted payload.
  if (stitchedCrossDomainBridges) {
    const bridges = truncateBridges(stitchedCrossDomainBridges, crossDomainBridgesMaxChars);
    const dim8 = cleanDimensions.find((d) => d.number === 8);
    if (dim8) {
      // Contract: 8.3 sits between 8.2 and 8.4 so readers see 8.1 → 8.4 in
      // order. Insert before an existing 8.4 heading, otherwise append.
      // Idempotent: never insert twice.
      const content = (dim8.content || "").trim();
      if (!content.includes(BRIDGES_HEADING) && !content.includes("8.3 Cross-Domain Bridges")) {
        const body = bridges.includes("8.3 Cross-Domain Bridges") ? bridges : `${BRIDGES_HEADING}\n\n${bridges}`;
        const at = content.search(/^#{1,6}\s*8\.4\b/m);
        dim8.content = at >= 0
          ? `${content.slice(0, at).trimEnd()}\n\n${body}\n\n${content.slice(at)}`
          : `${content}\n\n${body}`;
      }
    } else {
      stitchedPayload.crossDomainBridges = bridges;
      // Degraded case: grounded dim 8 never arrived. Keep the bridges on the
      // root field so the content survives (rendering falls back to the
      // payload field) but dim 8 stays absent — do not fabricate a dim-8 object.
      console.warn(
        "[stitch-analysis-chunks] crossDomainBridges present but dimension 8 missing — keeping bridges on payload root only",
      );
    }
  }

  if (stitchedDiscoveryPathways) {
    const pathways = truncateBridges(stitchedDiscoveryPathways, crossDomainBridgesMaxChars);
    const dim8 = cleanDimensions.find((d) => d.number === 8);
    if (dim8) {
      // Contract (CodeRabbit #366): the projective 8.4 is authoritative.
      // - dim 8 already has an 8.4 section (legacy grounded 8.4 on an older
      //   row, or a re-stitch): REPLACE that section, heading to the next
      //   8.x heading or end, so the external recommendations and the
      //   > [EXTERNAL_PROJECTION] delimiter always land;
      // - otherwise APPEND. 8.3 is stitched first, so the end of dim 8 is
      //   always after 8.1/8.2/8.3; never search from the top (that put 8.4
      //   above 8.1 when no 8.3 existed).
      // Replacing with an identical body is a no-op, so re-stitching is stable.
      const content = (dim8.content || "").trim();
      const body = /^#{1,6}\s*8\.4\b/m.test(pathways) ? pathways.trim() : `${PATHWAYS_HEADING}\n\n${pathways.trim()}`;
      const existingAt = content.search(/^#{1,6}\s*8\.4\b/m);
      if (existingAt >= 0) {
        const afterHeading = content.slice(existingAt + 1);
        const nextRelative = afterHeading.search(/^#{1,6}\s*8\.(?!4\b)\d/m);
        const sectionEnd = nextRelative >= 0 ? existingAt + 1 + nextRelative : content.length;
        const tail = content.slice(sectionEnd).trim();
        dim8.content = `${content.slice(0, existingAt).trimEnd()}\n\n${body}${tail ? `\n\n${tail}` : ""}`;
      } else {
        dim8.content = `${content}\n\n${body}`;
      }
    } else {
      stitchedPayload.discoveryPathways = pathways;
      // Degraded case: grounded dim 8 never arrived. Same root-field
      // preservation as 8.3 above — content survives on the payload root.
      console.warn(
        "[stitch-analysis-chunks] discoveryPathways present but dimension 8 missing — keeping pathways on payload root only",
      );
    }
  }

  // Validate stitched payload. The schema is .strict(), but LLMs routinely emit
  // benign extra keys (e.g. persona.tier2A, edges[].relation) — strip those and
  // retry rather than throwing away an otherwise-complete analysis.
  let parseResult = UCISPayloadV2Schema.safeParse(stitchedPayload);
  for (let pass = 0; !parseResult.success && pass < 3; pass++) {
    const unrecognized = parseResult.error.issues.filter(
      (i) => i.code === "unrecognized_keys",
    );
    if (unrecognized.length === 0) break;
    const FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"];
    for (const issue of unrecognized) {
      let target: any = stitchedPayload;
      for (const seg of issue.path) {
        if (FORBIDDEN_KEYS.includes(String(seg))) {
          target = undefined;
          break;
        }
        target = target?.[seg as any];
        if (!target) break;
      }
      if (target && typeof target === "object") {
        for (const key of (issue as any).keys as string[]) {
          if (!FORBIDDEN_KEYS.includes(key)) delete target[key];
        }
      }
    }
    parseResult = UCISPayloadV2Schema.safeParse(stitchedPayload);
  }

  if (!parseResult.success) {
    console.error(
      "[stitch-analysis-chunks] Stitched payload failed schema validation — preserving partial markdown",
      {
        dimNumbers: cleanDimensions.map((d) => d.number),
        issues: parseResult.error.issues.slice(0, 10),
      },
    );
    Sentry.captureMessage(
      "analysis-persist: stitched payload failed schema validation (partial preserved)",
      {
        level: "warning",
        tags: { operation: "analysis-persist", phase: "stitch_validation" },
        extra: { issues: parseResult.error.issues.slice(0, 20) },
      },
    );
    try {
      const partialMarkdown = reconstructMarkdown(stitchedPayload);
      if (partialMarkdown && partialMarkdown.trim().length > 0) {
        return {
          payload: stitchedPayload,
          markdown: partialMarkdown,
          validationPassed: false,
        };
      }
    } catch (partialErr) {
      const msg =
        partialErr instanceof Error ? partialErr.message : String(partialErr);
      console.error(
        "[stitch-analysis-chunks] partial markdown reconstruction failed:",
        msg,
      );
      Sentry.captureException(partialErr, {
        contexts: { stitch: { phase: 'partial_stitch' } }
      });
    }
    const fallbackMarkdown = cleanDimensions
      .map(
        (d) =>
          `## Dimension ${d.number} ${d.name || ""}\n\n${(d.content || "").trim()}`,
      )
      .join("\n\n---\n\n");
    return {
      payload: stitchedPayload,
      markdown:
        fallbackMarkdown ||
        `# Partial Analysis\n\n${cleanDimensions.length} dimensions recovered`,
      validationPassed: false,
    };
  }

  // Persist the schema-normalized classification and graph (alias keys
  // mapped, string booleans coerced, missing keyTerms defaulted), not the raw
  // chunk copy that only the validator saw normalized.
  const normalizedPayload = {
    ...stitchedPayload,
    classification: parseResult.data.classification,
    knowledgeGraph: parseResult.data.knowledgeGraph,
  };
  const stitchedMarkdown = reconstructMarkdown(normalizedPayload);
  return {
    payload: normalizedPayload,
    markdown: stitchedMarkdown,
    validationPassed: true,
  };
}
