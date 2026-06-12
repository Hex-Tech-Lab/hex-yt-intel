/**
 * MarkdownReconstructor — Dual-Write Persistence Adapter
 *
 * Reconstructs markdown from structured JSON payload (v2.0 schema).
 * Used for dual-write persistence to maintain backward compatibility
 * with the analysis_markdown column while also writing analysis_payload JSONB.
 *
 * ADR 006: Structured JSON Streaming Blueprint — Section 7.1
 */

interface UCISDimensionV2 {
  number: number;
  name: string;
  content: string;
  metadata?: {
    wordCount?: number;
    keyTerms?: string[];
    confidence?: number;
    insufficientData?: boolean;
  };
}

interface PersonaConfigV2 {
  primary: { id: string; label: string; weight: number };
  secondary?: { id: string; label: string; weight: number };
  tertiary?: { id: string; label: string; weight: number };
  cognitiveLenses: string[];
  selectionRationale: string;
}

interface UCISPayloadV2 {
  schemaVersion: '2.0';
  persona: PersonaConfigV2;
  dimensions: UCISDimensionV2[];
  knowledgeGraph?: {
    nodes: unknown[];
    edges: unknown[];
    rootId: string | null;
  };
  classification?: {
    authoritative: boolean;
    practicallyActionable: boolean;
    knowledgeGraphReady: boolean;
    safe: boolean;
    personaOptimised: boolean;
    recommendation: string;
  };
  monetizationVerdict?: {
    creator: string;
    indieMaker: string;
    consultant: string;
    researcher: string;
    productManager: string;
  };
}

/**
 * Reconstruct markdown from structured JSON payload.
 * Used for dual-write persistence (analysis_markdown column).
 */
export function reconstructMarkdown(payload: UCISPayloadV2): string {
  const lines: string[] = [];

  // Persona header (text format for backward compat)
  lines.push('=== PERSONA CONFIGURATION ===');
  lines.push(`Primary Persona:    ${payload.persona.primary.label} (Weight: ${Math.round(payload.persona.primary.weight * 100)}%)`);
  if (payload.persona.secondary) {
    lines.push(`Secondary Persona:  ${payload.persona.secondary.label} (Weight: ${Math.round(payload.persona.secondary.weight * 100)}%)`);
  }
  if (payload.persona.tertiary) {
    lines.push(`Tertiary Persona:   ${payload.persona.tertiary.label} (Weight: ${Math.round(payload.persona.tertiary.weight * 100)}%)`);
  }
  lines.push(`Active Cognitive Lenses: [${payload.persona.cognitiveLenses.join(', ')}]`);
  lines.push(`Selection Rationale: ${payload.persona.selectionRationale}`);
  lines.push('==============================');
  lines.push('');

  // Dimensions
  for (const dim of payload.dimensions) {
    lines.push(`### DIMENSION ${dim.number} – ${dim.name.toUpperCase()}`);
    lines.push('');
    lines.push(dim.content);
    lines.push('');
  }

  // Classification (if present)
  if (payload.classification) {
    lines.push('=== CLASSIFICATION ===');
    lines.push(`Authoritative:           ${payload.classification.authoritative}`);
    lines.push(`Practically Actionable:  ${payload.classification.practicallyActionable}`);
    lines.push(`Knowledge Graph Ready:   ${payload.classification.knowledgeGraphReady}`);
    lines.push(`Safe:                    ${payload.classification.safe}`);
    lines.push(`Persona Optimised:       ${payload.classification.personaOptimised}`);
    lines.push(`Recommendation:          ${payload.classification.recommendation}`);
    lines.push('');
  }

  // Monetization verdicts (if present)
  if (payload.monetizationVerdict) {
    lines.push('=== MONETIZATION VERDICTS ===');
    lines.push(`Creator:         ${payload.monetizationVerdict.creator}`);
    lines.push(`Indie Maker:     ${payload.monetizationVerdict.indieMaker}`);
    lines.push(`Consultant:      ${payload.monetizationVerdict.consultant}`);
    lines.push(`Researcher:      ${payload.monetizationVerdict.researcher}`);
    lines.push(`Product Manager: ${payload.monetizationVerdict.productManager}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Attempt to extract JSON payload from finalText.
 * Returns null if finalText is not valid v2.0 JSON.
 */
export function extractJsonPayload(finalText: string): UCISPayloadV2 | null {
  try {
    const parsed = JSON.parse(finalText);
    if (parsed && parsed.schemaVersion === '2.0' && Array.isArray(parsed.dimensions)) {
      if (!parsed.persona?.primary || typeof parsed.persona.primary !== 'object' || !('id' in parsed.persona.primary)) {
        return null;
      }
      return parsed as UCISPayloadV2;
    }
  } catch {
    // Not JSON or invalid
  }
  return null;
}