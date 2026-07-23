import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';

/**
 * Markdown Reconstructor Utility
 * Reconstructs markdown text from the structured JSON v2.0 payload.
 */
export function reconstructMarkdown(payload: Partial<UCISPayloadV2>): string {
  const lines: string[] = [];

  // Persona header (text format for backward compat)
  if (payload.persona) {
    lines.push('=== PERSONA CONFIGURATION ===');
    if (payload.persona.primary?.label) {
      lines.push(`Primary Persona:    ${payload.persona.primary.label} (Weight: ${Math.round((payload.persona.primary.weight || 0) * 100)}%)`);
    }
    if (payload.persona.secondary?.label) {
      lines.push(`Secondary Persona:  ${payload.persona.secondary.label} (Weight: ${Math.round((payload.persona.secondary.weight || 0) * 100)}%)`);
    }
    if (payload.persona.tertiary?.label) {
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

  // Classification (if present) -- rendered as markdown (this text is fed
  // straight to ReactMarkdown downstream) rather than "=== X ===" plain-text
  // banners, which render as unstyled paragraph text with no visual distinction
  // from the properly-formatted dimension content above it.
  if (payload.classification) {
    lines.push('#### Classification');
    lines.push('');
    if (payload.classification.authoritative !== undefined) {
      lines.push(`- **Authoritative:** ${payload.classification.authoritative}`);
    }
    if (payload.classification.practicallyActionable !== undefined) {
      lines.push(`- **Practically Actionable:** ${payload.classification.practicallyActionable}`);
    }
    if (payload.classification.knowledgeGraphReady !== undefined) {
      lines.push(`- **Knowledge Graph Ready:** ${payload.classification.knowledgeGraphReady}`);
    }
    if (payload.classification.safe !== undefined) {
      lines.push(`- **Safe:** ${payload.classification.safe}`);
    }
    if (payload.classification.personaOptimised !== undefined) {
      lines.push(`- **Persona Optimised:** ${payload.classification.personaOptimised}`);
    }
    if (payload.classification.recommendation !== undefined) {
      lines.push(`- **Recommendation:** ${payload.classification.recommendation}`);
    }
    lines.push('');
  }

  // Monetization verdicts (if present)
  if (payload.monetizationVerdict) {
    lines.push('#### Monetization Verdicts');
    lines.push('');
    lines.push(`- **Creator:** ${payload.monetizationVerdict.creator || 'N/A'}`);
    lines.push(`- **Indie Maker:** ${payload.monetizationVerdict.indieMaker || 'N/A'}`);
    lines.push(`- **Consultant:** ${payload.monetizationVerdict.consultant || 'N/A'}`);
    lines.push(`- **Researcher:** ${payload.monetizationVerdict.researcher || 'N/A'}`);
    lines.push(`- **Product Manager:** ${payload.monetizationVerdict.productManager || 'N/A'}`);
    lines.push('');
  }

  return lines.join('\n');
}
