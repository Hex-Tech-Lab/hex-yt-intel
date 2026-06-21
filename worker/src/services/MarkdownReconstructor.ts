import * as Sentry from '@sentry/cloudflare';

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
export function reconstructMarkdown(payload: Partial<UCISPayloadV2>): string {
  const lines: string[] = [];

  // Persona header (text format for backward compat)
  if (payload.persona) {
    lines.push('=== PERSONA CONFIGURATION ===');
    if (payload.persona.primary) {
      lines.push(`Primary Persona:    ${payload.persona.primary.label} (Weight: ${Math.round((payload.persona.primary.weight || 0) * 100)}%)`);
    }
    if (payload.persona.secondary) {
      lines.push(`Secondary Persona:  ${payload.persona.secondary.label} (Weight: ${Math.round((payload.persona.secondary.weight || 0) * 100)}%)`);
    }
    if (payload.persona.tertiary) {
      lines.push(`Tertiary Persona:   ${payload.persona.tertiary.label} (Weight: ${Math.round((payload.persona.tertiary.weight || 0) * 100)}%)`);
    }
    if (Array.isArray(payload.persona.cognitiveLenses)) {
      lines.push(`Active Cognitive Lenses: [${payload.persona.cognitiveLenses.join(', ')}]`);
    }
    if (payload.persona.selectionRationale) {
      lines.push(`Selection Rationale: ${payload.persona.selectionRationale}`);
    }
    lines.push('==============================');
    lines.push('');
  }

  // Dimensions
  if (Array.isArray(payload.dimensions)) {
    for (const dim of payload.dimensions) {
      if (dim && typeof dim.number === 'number' && typeof dim.content === 'string') {
        const name = dim.name || `Dimension ${dim.number}`;
        lines.push(`### DIMENSION ${dim.number} – ${name.toUpperCase()}`);
        lines.push('');
        lines.push(dim.content);
        lines.push('');
      }
    }
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
    lines.push(`Creator:         ${payload.monetizationVerdict.creator || 'N/A'}`);
    lines.push(`Indie Maker:     ${payload.monetizationVerdict.indieMaker || 'N/A'}`);
    lines.push(`Consultant:      ${payload.monetizationVerdict.consultant || 'N/A'}`);
    lines.push(`Researcher:      ${payload.monetizationVerdict.researcher || 'N/A'}`);
    lines.push(`Product Manager: ${payload.monetizationVerdict.productManager || 'N/A'}`);
    lines.push('');
  }

  return lines.join('\n');
}

function repairUnclosedJson(text: string): string | null {
  let inStr = false;
  let esc = false;
  const closers: string[] = [];

  for (const char of text) {
    if (esc) { esc = false; continue; }
    if (char === '\\' && inStr) { esc = true; continue; }
    if (char === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (char === '{') {
      if (closers.length > 500) return null;
      closers.push('}');
    } else if (char === '[') {
      if (closers.length > 500) return null;
      closers.push(']');
    } else if (char === '}' || char === ']') {
      if (closers.length === 0 || closers[closers.length - 1] !== char) {
        return null;
      }
      closers.pop();
    }
  }

  if (inStr) text += '"';
  text = text.replace(/,\s*$/, '');
  text += closers.reverse().join('');

  try {
    JSON.parse(text);
    return text;
  } catch (error) {
    console.debug('[repairUnclosedJson] Parse failed:', error);
    return null;
  }
}

/**
 * Attempt to extract JSON payload from finalText.
 * Returns null if finalText is not valid v2.0 JSON.
 */
export function extractJsonPayload(finalText: string): Partial<UCISPayloadV2> | null {
  if (!finalText) return null;

  try {
    // Locate the first '{' and the last '}'
    const start = finalText.indexOf('{');
    if (start === -1) return null;

    let cleanText = finalText;
    const end = finalText.lastIndexOf('}');
    if (end !== -1 && end > start) {
      // If there are trailing markdown blocks, slice to end of JSON object
      const nextChar = finalText.charAt(end + 1);
      if (nextChar === '\n' || nextChar === '\r' || nextChar === '' || nextChar === '`') {
        cleanText = cleanText.slice(start, end + 1);
      } else {
        cleanText = cleanText.slice(start);
      }
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleanText);
    } catch (error) {
      console.debug('[extractJsonPayload] Initial parse failed:', error);
      // Try to repair unclosed JSON brackets/quotes
      const repaired = repairUnclosedJson(cleanText);
      if (repaired) {
        try {
          parsed = JSON.parse(repaired);
        } catch (repairError) {
          console.debug('[extractJsonPayload] Repaired parse failed:', repairError);
        }
      }
    }

    if (parsed && parsed.schemaVersion === '2.0' && Array.isArray(parsed.dimensions)) {
      if (parsed.persona) {
        if (!parsed.persona.primary || typeof parsed.persona.primary !== 'object' || !('id' in parsed.persona.primary)) {
          // Keep dimensions and strip invalid/incomplete persona configs to prevent chunk failures
          delete parsed.persona;
        }
      }
      return parsed as Partial<UCISPayloadV2>;
    }
  } catch (error: any) {
    Sentry.captureException(error, { contexts: { extractJsonPayload: { finalTextLength: finalText.length } } });
    console.debug('[extractJsonPayload] Failed to parse JSON:', error instanceof Error ? error.message : String(error));
  }
  return null;
}