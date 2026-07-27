import { UCISValidator } from '@/lib/ucis-v5-validator';

describe('UCISValidator', () => {
  const validV2Payload = JSON.stringify({
    schemaVersion: '2.0',
    persona: {
      primary: { id: 'creator', label: 'Content Creator', weight: 0.5 },
      secondary: { id: 'indieMaker', label: 'Indie Maker', weight: 0.25 },
      tertiary: { id: 'consultant', label: 'Consultant', weight: 0.15 },
      cognitiveLenses: ['First Principles', 'Systems Thinking'],
      selectionRationale: 'Optimized for creator growth',
    },
    dimensions: [
      { number: 1, name: 'Apex Intelligence', content: 'Apex summary content here' },
      { number: 2, name: 'Provenance & Metadata', content: 'Provenance content here' },
      { number: 3, name: 'Content Architecture', content: 'Content architecture content here' },
      { number: 4, name: 'Psychological Layer', content: 'Psychological layer content here' },
      { number: 5, name: 'Core Intelligence', content: 'Core intelligence content here' },
      { number: 6, name: 'Comparative & Quantitative', content: 'Comparative content here' },
      { number: 7, name: 'Implementation Systems', content: 'Implementation content here' },
      { number: 8, name: 'Semantic Graph Foundation', content: 'Semantic content here' },
      { number: 9, name: 'Forward Intelligence', content: 'Forward intelligence content here' },
      { number: 10, name: 'Credibility & Meta-Assessment', content: 'Credibility content here' },
      { number: 11, name: 'Commercial Yield', content: 'Monetization content here' },
    ],
    knowledgeGraph: {
      nodes: [
        { id: 'n1', dimension: 8, label: 'Node 1', content: 'Domain node content here', weight: 8, polarity: 1, keyTerms: ['term1'], entityType: 'concept' }
      ],
      edges: [
        { source: 'n1', target: 'n1', strength: 7, kind: 'related', rationale: 'Self reference' }
      ],
      rootId: 'n1',
    },
    classification: {
      authoritative: true,
      practicallyActionable: true,
      knowledgeGraphReady: true,
      safe: true,
      personaOptimised: true,
      recommendation: 'highly_recommended',
    },
    monetizationVerdict: {
      creator: 'Highly Viable',
      indieMaker: 'Viable',
      consultant: 'Conditional',
      researcher: 'Conditional',
      productManager: 'Conditional',
    },
  });

  describe('Contract Validation via UCISValidator.validate', () => {
    it('should pass validation for a fully compliant v2.0 JSON payload', () => {
      const report = UCISValidator.validate(validV2Payload, 'test-video-2026-07-27.md');
      if (!report.passed) {
        console.log('Test Failed Checks:', JSON.stringify(report.failedChecks, null, 2));
      }
      expect(report.passed).toBe(true);
      expect(report.failedChecks.length).toBe(0);
      expect(report.passedChecks).toBeGreaterThan(0);
    });

    it('should detect schema contract violations for malformed JSON payload', () => {
      const malformedPayload = JSON.stringify({
        schemaVersion: '1.0', // Wrong schemaVersion
        persona: null,
      });
      const report = UCISValidator.validate(malformedPayload, 'test-video-2026-07-27.md');
      expect(report.passed).toBe(false);
      expect(report.failedChecks.length).toBeGreaterThan(0);
    });

    it('should fallback gracefully for non-JSON markdown input', () => {
      const markdown = `
        ### DIMENSION 1 – APEX INTELLIGENCE
        This is raw markdown analysis content.
      `;
      const report = UCISValidator.validate(markdown, 'test-video-2026-07-27.md');
      expect(report.totalChecks).toBeGreaterThan(0);
    });
  });
});
