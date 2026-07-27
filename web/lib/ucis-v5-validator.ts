import { UCISPayloadV2Schema } from '@/lib/validators/synthesis';

export interface ValidationCheckResult {
  ok: boolean;
  section: string;
  reason?: string;
}

export interface ValidationReport {
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: ValidationCheckResult[];
  timestamp: string;
}

/**
 * UCIS Contract Validator (v2.0 / v5.1)
 * Enforces Zod contract boundary validation with ZERO fragile regular expressions.
 */
export class UCISValidator {
  /**
   * Main contract validation entry point.
   * Parses JSON or structured payload against authoritative UCISPayloadV2Schema.
   */
  static validate(output: string, filename: string): ValidationReport {
    const checks: ValidationCheckResult[] = [];

    let parsedPayload: unknown = null;
    let isJson = false;

    // 1️⃣ Attempt JSON Parse against UCISPayloadV2Schema contract
    try {
      if (typeof output === 'string' && (output.trim().startsWith('{') || output.includes('"schemaVersion"'))) {
        const jsonStart = output.indexOf('{');
        const jsonEnd = output.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          parsedPayload = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
          isJson = true;
        }
      }
    } catch {
      isJson = false;
    }

    if (isJson && parsedPayload) {
      // Validate against authoritative Zod Contract Schema
      const contractResult = UCISPayloadV2Schema.safeParse(parsedPayload);
      if (contractResult.success) {
        const data = contractResult.data;
        
        checks.push({ ok: true, section: 'Schema Version' });
        checks.push({ ok: data.dimensions.length >= 10, section: 'Dimension Count', reason: data.dimensions.length < 10 ? `Expected at least 10 dimensions, found ${data.dimensions.length}` : undefined });
        checks.push({ ok: !!data.persona?.primary, section: 'Persona Configuration' });
        checks.push({ ok: Array.isArray(data.persona?.cognitiveLenses) && data.persona.cognitiveLenses.length >= 1, section: 'Cognitive Lenses' });
        checks.push({ ok: Array.isArray(data.knowledgeGraph?.nodes) && data.knowledgeGraph.nodes.length >= 1, section: 'Knowledge Graph Nodes' });
        checks.push({ ok: Array.isArray(data.knowledgeGraph?.edges), section: 'Knowledge Graph Edges' });
        checks.push({ ok: typeof data.classification?.recommendation === 'string', section: 'Classification Recommendation' });
        checks.push({ ok: !!data.monetizationVerdict, section: 'Monetization Verdict' });
      } else {
        // Collect exact Zod contract boundary errors
        for (const issue of contractResult.error.issues) {
          checks.push({
            ok: false,
            section: `Contract Boundary: ${issue.path.join('.') || 'root'}`,
            reason: `${issue.message} (${issue.code})`,
          });
        }
      }
    } else {
      // Non-JSON Markdown Contract Fallback: Validate key structural markers without regexes
      const hasContent = typeof output === 'string' && output.trim().length > 100;
      checks.push({ ok: hasContent, section: 'Content Presence', reason: !hasContent ? 'Analysis output is empty or truncated' : undefined });
      
      const hasDimensions = output.toLowerCase().includes('dimension') || output.includes('###');
      checks.push({ ok: hasDimensions, section: 'Dimension Coverage', reason: !hasDimensions ? 'Missing dimension structures' : undefined });
      
      const hasFilename = typeof filename === 'string' && filename.length > 5;
      checks.push({ ok: hasFilename, section: 'Filename Specification', reason: !hasFilename ? 'Invalid filename' : undefined });
    }

    const failedChecks = checks.filter((check) => !check.ok);
    const passedChecks = checks.length - failedChecks.length;

    return {
      passed: failedChecks.length === 0,
      totalChecks: checks.length,
      passedChecks,
      failedChecks,
      timestamp: new Date().toISOString(),
    };
  }
}
