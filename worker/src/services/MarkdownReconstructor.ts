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

function trackStringState(char: string, inStr: boolean, esc: boolean): { inStr: boolean; esc: boolean } {
  if (esc) return { inStr, esc: false };
  if (char === '\\' && inStr) return { inStr, esc: true };
  if (char === '"') return { inStr: !inStr, esc: false };
  return { inStr, esc: false };
}

function trackBracketState(char: string, closers: string[]): string[] | null {
  const openerToCloser: Record<string, string> = { '{': '}', '[': ']' };
  const closer = openerToCloser[char];
  if (closer) {
    if (closers.length > 500) return null;
    closers.push(closer);
  } else if (char === '}' || char === ']') {
    if (closers.length === 0 || closers[closers.length - 1] !== char) return null;
    closers.pop();
  }
  return closers;
}

function repairUnclosedJson(text: string): string | null {
  let inStr = false;
  let esc = false;
  const closers: string[] = [];

  for (const char of text) {
    const prevEsc = esc;
    const strState = trackStringState(char, inStr, esc);
    inStr = strState.inStr;
    esc = strState.esc;
    if (prevEsc || esc || inStr) continue;
    const result = trackBracketState(char, closers);
    if (!result) return null;
  }

  if (inStr) text += '"';
  text = text.trim();
  if (text.endsWith(',')) text = text.slice(0, -1);
  text += closers.reverse().join('');

  try {
    JSON.parse(text);
    return text;
  } catch (error) {
    console.debug('[repairUnclosedJson] Parse failed:', error);
    return null;
  }
}

function locateJsonBounds(text: string): { start: number; end: number } | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  const end = text.lastIndexOf('}');
  return { start, end };
}

function safeParse(text: string, phase: string, finishReason?: string): { parsed: Partial<UCISPayloadV2> | null; repaired: string | null } {
  try {
    return { parsed: JSON.parse(text) as Partial<UCISPayloadV2>, repaired: null };
  } catch (error) {
    Sentry.captureException(error, { contexts: { extractJsonPayload: { phase, textLength: text.length, finishReason: finishReason || 'unknown' } } });
    const message = error instanceof Error ? error.message : String(error);
    console.error('[extractJsonPayload]', { message, phase, finishReason });
    const repaired = repairUnclosedJson(text);
    if (!repaired) return { parsed: null, repaired: null };
    try {
      return { parsed: JSON.parse(repaired) as Partial<UCISPayloadV2>, repaired };
    } catch (repairError) {
      Sentry.captureException(repairError, { contexts: { extractJsonPayload: { phase: 'repaired_parse', repairedTextLength: repaired.length, finishReason: finishReason || 'unknown' } } });
      const repairMessage = repairError instanceof Error ? repairError.message : String(repairError);
      console.error('[extractJsonPayload]', { message: repairMessage, phase: 'repaired_parse', finishReason });
      return { parsed: null, repaired: null };
    }
  }
}

function sanitizePersona(parsed: Partial<UCISPayloadV2>): void {
  if (!parsed.persona) return;
  if (!parsed.persona.cognitiveLenses || !Array.isArray(parsed.persona.cognitiveLenses)) {
    parsed.persona.cognitiveLenses = [];
  }
  if (!parsed.persona.selectionRationale || typeof parsed.persona.selectionRationale !== 'string') {
    parsed.persona.selectionRationale = '';
  }
}

/**
 * Attempt to extract JSON payload from finalText.
 * Returns null if finalText is not valid v2.0 JSON.
 */
export function extractJsonPayload(finalText: string, finishReason?: string): Partial<UCISPayloadV2> | null {
  if (!finalText) return null;

  try {
    const bounds = locateJsonBounds(finalText);
    if (!bounds) {
      console.debug('[extractJsonPayload] No JSON bounds found', {
        finalTextLength: finalText.length,
        textPreview: finalText.slice(0, 200),
        finishReason: finishReason || 'unknown',
      });
      return null;
    }

    const { start, end } = bounds;
    let cleanText = finalText;
    if (end > start) {
      const trailingChars = new Set(['\n', '\r', '', '`', ' ', '\t']);
      const nextChar = finalText.charAt(end + 1);
      cleanText = trailingChars.has(nextChar) ? cleanText.slice(start, end + 1) : cleanText.slice(start);
    }

    const { parsed } = safeParse(cleanText, 'initial_parse', finishReason);
    if (!parsed) {
      console.debug('[extractJsonPayload] Parse failed for extracted JSON', {
        extractedLength: cleanText.length,
        extractedPreview: cleanText.slice(0, 300),
        finishReason: finishReason || 'unknown',
      });
      return null;
    }

    if (parsed.schemaVersion === '2.0' && Array.isArray(parsed.dimensions)) {
      sanitizePersona(parsed);
      console.debug('[extractJsonPayload] Successfully extracted v2.0 payload with dimensions', {
        dimensionCount: parsed.dimensions.length,
        schemaVersion: parsed.schemaVersion,
        finishReason: finishReason || 'unknown',
      });
      return parsed;
    }

    console.debug('[extractJsonPayload] Parsed JSON but missing v2.0 structure', {
      hasSchemaVersion: 'schemaVersion' in parsed,
      schemaVersion: parsed.schemaVersion,
      isDimensionsArray: Array.isArray(parsed.dimensions),
      hasDimensions: 'dimensions' in parsed,
      finishReason: finishReason || 'unknown',
    });
  } catch (error: unknown) {
    Sentry.captureException(error, { contexts: { extractJsonPayload: { finalTextLength: finalText.length, finishReason: finishReason || 'unknown' } } });
    const message = error instanceof Error ? error.message : String(error);
    console.error('[extractJsonPayload]', { message, finalTextLength: finalText.length, finishReason });
  }
  return null;
}