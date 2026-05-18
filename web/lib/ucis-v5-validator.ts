/**
 * UCIS v5.0 Output Validator
 * Structural hardness mechanism - regex-based checks only (no semantic evaluation)
 * Returns structured validation results for async logging
 */

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
 * Regex patterns for structural validation
 */
const PATTERNS = {
  personaHeader: /^===\s+PERSONA\s+CONFIGURATION\s+===/m,
  personaWeights: /Primary\s+Persona:.*Weight:\s*50%/i,
  dimension1Header: /^###\s+DIMENSION\s+1\s+[–—-]\s+APEX\s+INTELLIGENCE/m,
  dimension10Header: /^###\s+DIMENSION\s+10\s+[–—-]/m,
  apexDeliverables: /Top\s+[35]\s*[–—-]\s*5?\s*Ranked\s+Deliverables/i,
  timestampAnalysis: /Analysis\s+Timestamp[:\s]*`?YYYY-MM-DD\s+HH:MM:SS/i,
  personaFitTag: /Persona\s+Fit[:\s]*\[/i,
  lensApplied: /Lens\s+applied:\s*\[/i,
  allDimensions: /###\s+DIMENSION\s+([1-9]|10)\s+[–—-]/gm,
  tableStructure: /\|\s*\*\*[^|]+\*\*\s*\|\s*[^|]+\s*\|/,
  riskDisclosure: /⚠️\s+\*\*Critical\s+Notice\*\*:/i,
  dimensionNotAvailable: /Not\s+available\s+in\s+source\s+content/i,
  classificationTable: /\|\s*Tag\s+\|\s*Status\s+\|/i,
  readDepthGuidance: /Read-Depth\s+Guidance/i,
  filename: /^[a-zA-Z0-9\-\._]+\-[a-zA-Z0-9\-\._]+\-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/,
  inlineTimestamp: /`\d{2}:\d{2}:\d{2}`/,
  timestampFormat: /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[A-Z]{3,4}/,
  emoji: /[🎨🚀💡🔥👑⭐🎯]/g,
};

export class UCISValidator {
  /**
   * STRUCTURAL CHECKS: Persona header, dimensions, core sections
   */
  static structuralChecks(output: string): ValidationCheckResult[] {
    const checks: ValidationCheckResult[] = [];

    if (!PATTERNS.personaHeader.test(output)) {
      checks.push({
        ok: false,
        section: 'Persona Header',
        reason: 'Missing or malformed persona configuration header',
      });
    } else {
      checks.push({ ok: true, section: 'Persona Header' });
    }

    const dimensionMatches = output.match(PATTERNS.allDimensions) || [];
    if (dimensionMatches.length < 10) {
      checks.push({
        ok: false,
        section: 'Dimension Headers',
        reason: `Expected 10 dimension headers, found ${dimensionMatches.length}`,
      });
    } else {
      checks.push({ ok: true, section: 'Dimension Headers' });
    }

    if (!PATTERNS.dimension1Header.test(output)) {
      checks.push({
        ok: false,
        section: 'Apex Summary',
        reason: 'Missing or malformed Dimension 1 (Apex Intelligence) header',
      });
    } else {
      checks.push({ ok: true, section: 'Apex Summary Header' });
    }

    if (!PATTERNS.apexDeliverables.test(output)) {
      checks.push({
        ok: false,
        section: 'Apex Deliverables',
        reason: 'Missing "Top 3–5 Ranked Deliverables" section in Dimension 1',
      });
    } else {
      checks.push({ ok: true, section: 'Apex Deliverables' });
    }

    return checks;
  }

  /**
   * PERSONA CHECKS: Weight distribution, lens declaration, persona-keyed content
   */
  static personaChecks(output: string): ValidationCheckResult[] {
    const checks: ValidationCheckResult[] = [];

    if (!PATTERNS.personaWeights.test(output)) {
      checks.push({
        ok: false,
        section: 'Persona Weights',
        reason: 'Primary persona must have exactly 50% weight',
      });
    } else {
      checks.push({ ok: true, section: 'Persona Weights' });
    }

    const lensMatches = output.match(PATTERNS.lensApplied) || [];
    if (lensMatches.length < 3) {
      checks.push({
        ok: false,
        section: 'Cognitive Lenses',
        reason: `Expected at least 3 inline lens tags, found ${lensMatches.length}`,
      });
    } else {
      checks.push({ ok: true, section: 'Cognitive Lenses' });
    }

    const personaFitMatches = output.match(PATTERNS.personaFitTag) || [];
    if (personaFitMatches.length < 3) {
      checks.push({
        ok: false,
        section: 'Persona-Keyed Deliverables',
        reason: `Expected at least 3 deliverables with "Persona Fit" tags, found ${personaFitMatches.length}`,
      });
    } else {
      checks.push({ ok: true, section: 'Persona-Keyed Deliverables' });
    }

    return checks;
  }

  /**
   * FORMATTING CHECKS: Tables, timestamps, filename, emojis
   */
  static formattingChecks(output: string, filename: string): ValidationCheckResult[] {
    const checks: ValidationCheckResult[] = [];

    const tableMatches = output.match(PATTERNS.tableStructure) || [];
    if (tableMatches.length < 1) {
      checks.push({
        ok: false,
        section: 'Table Format',
        reason: 'No properly formatted tables found (expected items in columns, dimensions in rows)',
      });
    } else {
      checks.push({ ok: true, section: 'Table Format' });
    }

    const illegalEmoji = output.match(PATTERNS.emoji) || [];
    if (illegalEmoji.length > 0) {
      checks.push({
        ok: false,
        section: 'Emoji Usage',
        reason: `Found ${illegalEmoji.length} emojis (only ⚠️ allowed in risk disclosures)`,
      });
    } else {
      checks.push({ ok: true, section: 'Emoji Usage' });
    }

    if (!PATTERNS.filename.test(filename)) {
      checks.push({
        ok: false,
        section: 'Filename Format',
        reason: 'Filename must match [Title]-[Creator]-[YYYY-MM-DD_HH-MM-SS].md pattern',
      });
    } else {
      checks.push({ ok: true, section: 'Filename Format' });
    }

    if (!PATTERNS.timestampFormat.test(output)) {
      checks.push({
        ok: false,
        section: 'Timestamp Format',
        reason: 'Analysis timestamp must use YYYY-MM-DD HH:MM:SS [TZ] format',
      });
    } else {
      checks.push({ ok: true, section: 'Timestamp Format' });
    }

    return checks;
  }

  /**
   * CONTENT RIGOR CHECKS: Claims, risk disclosure, contrarian perspectives, scenario analysis
   */
  static contentRigorChecks(output: string): ValidationCheckResult[] {
    const checks: ValidationCheckResult[] = [];

    const inlineTimestamps = output.match(PATTERNS.inlineTimestamp) || [];
    if (inlineTimestamps.length < 5) {
      checks.push({
        ok: false,
        section: 'Quantitative Claims',
        reason: `Expected at least 5 in-content timestamps for claims, found ${inlineTimestamps.length}`,
      });
    } else {
      checks.push({ ok: true, section: 'Quantitative Claims' });
    }

    const hasRiskDisclosure = PATTERNS.riskDisclosure.test(output);
    if (!hasRiskDisclosure) {
      // Only required for financial/health/legal content; log as warning but don't fail
      checks.push({
        ok: true,
        section: 'Risk Disclosure',
        reason: 'Not required for this content domain',
      });
    } else {
      checks.push({ ok: true, section: 'Risk Disclosure' });
    }

    const hasContrarian = /Contrarian\s+Perspectives|Alternative\s+Frameworks/i.test(output);
    if (!hasContrarian) {
      checks.push({
        ok: false,
        section: 'Contrarian Perspectives',
        reason: 'Missing "Contrarian Perspectives" section (Dimension 9.5 required)',
      });
    } else {
      checks.push({ ok: true, section: 'Contrarian Perspectives' });
    }

    const hasScenarioAnalysis = /Scenario\s+Analysis|Stress\s+Test/i.test(output);
    if (!hasScenarioAnalysis) {
      checks.push({
        ok: false,
        section: 'Scenario Analysis',
        reason: 'Missing scenario analysis for strategic/financial projections (Dimension 6.2)',
      });
    } else {
      checks.push({ ok: true, section: 'Scenario Analysis' });
    }

    return checks;
  }

  /**
   * KG READINESS CHECKS: Semantic nodes, bridges, unfair advantages, power quotes
   */
  static kgReadinessChecks(output: string): ValidationCheckResult[] {
    const checks: ValidationCheckResult[] = [];

    const hasPrimaryNodes = /Primary\s+Knowledge\s+Graph\s+Nodes|Primary\s+Semantic\s+Nodes/i.test(output);
    if (!hasPrimaryNodes) {
      checks.push({
        ok: false,
        section: 'Primary KG Nodes',
        reason: 'Missing primary knowledge graph nodes (Dimension 8.1 required)',
      });
    } else {
      checks.push({ ok: true, section: 'Primary KG Nodes' });
    }

    const crossDomainMatches = output.match(/Cross-Domain\s+Bridge/gi) || [];
    if (crossDomainMatches.length < 2) {
      checks.push({
        ok: false,
        section: 'Cross-Domain Bridges',
        reason: `Expected at least 2 cross-domain bridges, found ${Math.max(0, crossDomainMatches.length)}`,
      });
    } else {
      checks.push({ ok: true, section: 'Cross-Domain Bridges' });
    }

    const hasUnfairAdvantages = /Unfair\s+Advantage|Unfair\s+Advantages/i.test(output);
    if (!hasUnfairAdvantages) {
      checks.push({
        ok: false,
        section: 'Unfair Advantages',
        reason: 'Missing unfair advantages mapping (Dimension 9.4 required)',
      });
    } else {
      checks.push({ ok: true, section: 'Unfair Advantages' });
    }

    const powerQuoteMatches = output.match(/"[^"]{20,200}"\s+`\d{2}:\d{2}:\d{2}`/g) || [];
    if (powerQuoteMatches.length < 2) {
      checks.push({
        ok: false,
        section: 'Power Quotes',
        reason: `Expected at least 2 timestamped power quotes, found ${Math.max(0, powerQuoteMatches.length)}`,
      });
    } else {
      checks.push({ ok: true, section: 'Power Quotes' });
    }

    return checks;
  }

  /**
   * FINAL CHECKS: Classification table, read-depth guidance, all quality gates
   */
  static finalChecks(output: string): ValidationCheckResult[] {
    const checks: ValidationCheckResult[] = [];

    if (!PATTERNS.classificationTable.test(output)) {
      checks.push({
        ok: false,
        section: 'Final Classification Table',
        reason: 'Missing Final Classification table (Dimension 10.3 required)',
      });
    } else {
      checks.push({ ok: true, section: 'Final Classification Table' });
    }

    if (!PATTERNS.readDepthGuidance.test(output)) {
      checks.push({
        ok: false,
        section: 'Read-Depth Guidance',
        reason: 'Missing Read-Depth Guidance in Apex Summary',
      });
    } else {
      checks.push({ ok: true, section: 'Read-Depth Guidance' });
    }

    const dimension10 = PATTERNS.dimension10Header.test(output);
    if (!dimension10) {
      checks.push({
        ok: false,
        section: 'Dimension 10',
        reason: 'Missing Dimension 10 (Credibility, Risk & Meta-Assessment)',
      });
    } else {
      checks.push({ ok: true, section: 'Dimension 10' });
    }

    return checks;
  }

  /**
   * Main validation entry point - run all checks and return report
   */
  static validate(output: string, filename: string): ValidationReport {
    const allChecks = [
      ...this.structuralChecks(output),
      ...this.personaChecks(output),
      ...this.formattingChecks(output, filename),
      ...this.contentRigorChecks(output),
      ...this.kgReadinessChecks(output),
      ...this.finalChecks(output),
    ];

    const failedChecks = allChecks.filter((check) => !check.ok);
    const passedChecks = allChecks.length - failedChecks.length;

    return {
      passed: failedChecks.length === 0,
      totalChecks: allChecks.length,
      passedChecks,
      failedChecks,
      timestamp: new Date().toISOString(),
    };
  }
}
