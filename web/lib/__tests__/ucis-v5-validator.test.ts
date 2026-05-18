import { UCISValidator } from '../ucis-v5-validator';

describe('UCISValidator', () => {
  describe('Structural Checks', () => {
    it('should pass with complete persona header', () => {
      const output = `=== PERSONA CONFIGURATION ===
Primary Persona:    P1 Content Creator (Weight: 50%)
Secondary Persona:  P2 Indie Maker (Weight: 25%)
==============================

### DIMENSION 1 – APEX INTELLIGENCE
Content here`;
      const checks = UCISValidator.structuralChecks(output);
      expect(checks.some((c) => c.section === 'Persona Header' && c.ok)).toBe(true);
    });

    it('should fail without persona header', () => {
      const output = 'No persona header here';
      const checks = UCISValidator.structuralChecks(output);
      expect(checks.some((c) => c.section === 'Persona Header' && !c.ok)).toBe(true);
    });

    it('should check for all 10 dimension headers', () => {
      const output = `### DIMENSION 1 – APEX INTELLIGENCE
### DIMENSION 2 – PROVENANCE
### DIMENSION 3 – CONTENT ARCHITECTURE
### DIMENSION 4 – PSYCHOLOGICAL
### DIMENSION 5 – CORE INTELLIGENCE
### DIMENSION 6 – COMPARATIVE
### DIMENSION 7 – IMPLEMENTATION
### DIMENSION 8 – SEMANTIC
### DIMENSION 9 – FORWARD INTELLIGENCE
### DIMENSION 10 – CREDIBILITY`;
      const checks = UCISValidator.structuralChecks(output);
      expect(checks.some((c) => c.section === 'Dimension Headers' && c.ok)).toBe(true);
    });

    it('should fail with insufficient dimension headers', () => {
      const output = `### DIMENSION 1 – APEX INTELLIGENCE
### DIMENSION 2 – PROVENANCE`;
      const checks = UCISValidator.structuralChecks(output);
      expect(checks.some((c) => c.section === 'Dimension Headers' && !c.ok)).toBe(true);
    });
  });

  describe('Persona Checks', () => {
    it('should verify primary persona weight is 50%', () => {
      const output = 'Primary Persona:    P1 Content Creator (Weight: 50%)';
      const checks = UCISValidator.personaChecks(output);
      expect(checks.some((c) => c.section === 'Persona Weights' && c.ok)).toBe(true);
    });

    it('should fail if primary persona weight is not 50%', () => {
      const output = 'Primary Persona:    P1 Content Creator (Weight: 60%)';
      const checks = UCISValidator.personaChecks(output);
      expect(checks.some((c) => c.section === 'Persona Weights' && !c.ok)).toBe(true);
    });

    it('should count inline lens tags', () => {
      const output = `
Lens applied: [First Principles]
Some content here.
Lens applied: [Game Theory]
More content.
Lens applied: [Systems Thinking]`;
      const checks = UCISValidator.personaChecks(output);
      expect(checks.some((c) => c.section === 'Cognitive Lenses' && c.ok)).toBe(true);
    });

    it('should fail with fewer than 3 lens tags', () => {
      const output = `Lens applied: [First Principles]`;
      const checks = UCISValidator.personaChecks(output);
      expect(checks.some((c) => c.section === 'Cognitive Lenses' && !c.ok)).toBe(true);
    });
  });

  describe('Formatting Checks', () => {
    it('should detect proper table format', () => {
      const output = `| **Factor** | Score |
|---|---|
| Item A | 8 |`;
      const checks = UCISValidator.formattingChecks(output, 'test-title-author-2026-05-18_14-30-45.md');
      expect(checks.some((c) => c.section === 'Table Format' && c.ok)).toBe(true);
    });

    it('should validate filename format', () => {
      const checks = UCISValidator.formattingChecks('', 'valid-title-author-2026-05-18_14-30-45.md');
      expect(checks.some((c) => c.section === 'Filename Format' && c.ok)).toBe(true);
    });

    it('should fail on invalid filename format', () => {
      const checks = UCISValidator.formattingChecks('', 'invalid_filename.md');
      expect(checks.some((c) => c.section === 'Filename Format' && !c.ok)).toBe(true);
    });

    it('should detect emojis (except ⚠️)', () => {
      const output = 'This has an 🚀 emoji which is not allowed';
      const checks = UCISValidator.formattingChecks(output, 'valid-title-author-2026-05-18_14-30-45.md');
      expect(checks.some((c) => c.section === 'Emoji Usage' && !c.ok)).toBe(true);
    });

    it('should allow ⚠️ in risk disclosures', () => {
      const output = '⚠️ **Critical Notice**: This is allowed';
      const checks = UCISValidator.formattingChecks(output, 'valid-title-author-2026-05-18_14-30-45.md');
      // The check looks for illegal emoji, so ⚠️ should be fine
      const emojiCheck = checks.find((c) => c.section === 'Emoji Usage');
      expect(emojiCheck?.ok || emojiCheck === undefined).toBe(true);
    });
  });

  describe('Content Rigor Checks', () => {
    it('should count in-content timestamps', () => {
      const output = `Insight at \`00:23:45\` and another at \`01:12:30\` and more at \`02:05:15\` and here \`03:40:22\` plus \`04:15:10\``;
      const checks = UCISValidator.contentRigorChecks(output);
      expect(checks.some((c) => c.section === 'Quantitative Claims' && c.ok)).toBe(true);
    });

    it('should fail with insufficient timestamps', () => {
      const output = 'Only one timestamp \`00:23:45\`';
      const checks = UCISValidator.contentRigorChecks(output);
      expect(checks.some((c) => c.section === 'Quantitative Claims' && !c.ok)).toBe(true);
    });

    it('should detect contrarian perspectives section', () => {
      const output = '## Contrarian Perspectives\nHere are alternative viewpoints...';
      const checks = UCISValidator.contentRigorChecks(output);
      expect(checks.some((c) => c.section === 'Contrarian Perspectives' && c.ok)).toBe(true);
    });

    it('should fail without contrarian perspectives', () => {
      const output = 'No contrarian section here';
      const checks = UCISValidator.contentRigorChecks(output);
      expect(checks.some((c) => c.section === 'Contrarian Perspectives' && !c.ok)).toBe(true);
    });
  });

  describe('KG Readiness Checks', () => {
    it('should find primary semantic nodes section', () => {
      const output = '## Primary Semantic Nodes\n- Node 1\n- Node 2';
      const checks = UCISValidator.kgReadinessChecks(output);
      expect(checks.some((c) => c.section === 'Primary KG Nodes' && c.ok)).toBe(true);
    });

    it('should count cross-domain bridges', () => {
      const output = `
Cross-Domain Bridge: From AI to healthcare
Text here.
Cross-Domain Bridge: From marketing to psychology`;
      const checks = UCISValidator.kgReadinessChecks(output);
      expect(checks.some((c) => c.section === 'Cross-Domain Bridges' && c.ok)).toBe(true);
    });

    it('should detect unfair advantages', () => {
      const output = '## Unfair Advantages\nHere is the competitive edge...';
      const checks = UCISValidator.kgReadinessChecks(output);
      expect(checks.some((c) => c.section === 'Unfair Advantages' && c.ok)).toBe(true);
    });
  });

  describe('Final Checks', () => {
    it('should validate final classification table', () => {
      const output = `| Tag | Status |
|---|---|
| Authoritative | ✓ |`;
      const checks = UCISValidator.finalChecks(output);
      expect(checks.some((c) => c.section === 'Final Classification Table' && c.ok)).toBe(true);
    });

    it('should check for read-depth guidance', () => {
      const output = '## Read-Depth Guidance\n- 60 seconds: stop here';
      const checks = UCISValidator.finalChecks(output);
      expect(checks.some((c) => c.section === 'Read-Depth Guidance' && c.ok)).toBe(true);
    });
  });

  describe('Full Validation Report', () => {
    it('should generate passing report for complete output', () => {
      const completeOutput = `=== PERSONA CONFIGURATION ===
Primary Persona:    P1 Content Creator (Weight: 50%)
Secondary Persona:  P2 Indie Maker (Weight: 25%)
Tertiary Persona:   P3 Consultant (Weight: 15%)
Tier-2 Persona A:   P4 Researcher (Weight: 5%)
Tier-2 Persona B:   P5 Product Manager (Weight: 5%)
Active Cognitive Lenses: First Principles, Game Theory, Systems Thinking
Selection Rationale: Content is creator-focused.
==============================

### DIMENSION 1 – APEX INTELLIGENCE
**The Core Thesis**: Test thesis
**The Unfair Advantage**: Test advantage

**Top 3–5 Ranked Deliverables for P1 Content Creator**:
1. **Deliverable 1** – Value statement
   - **Action**: Step-by-step action
   - **Persona Fit**: [Primary]
   - **Source Anchor**: \`00:23:45\`

**Read-Depth Guidance**:
- *60 seconds*: stop here.
- *5 minutes*: read more.

### DIMENSION 2 – PROVENANCE
| Field | Value |
|---|---|
| Title | Test |

### DIMENSION 3 – CONTENT ARCHITECTURE
**Executive Overview**
Detailed narrative here.

### DIMENSION 4 – PSYCHOLOGICAL
**Sentiment Profile**
Tone assessment.

### DIMENSION 5 – CORE INTELLIGENCE
**Tier 1 Insights**
1. **Insight** \`00:45:30\`
   - Detailed explanation.
   - Lens applied: [First Principles]

**Power Quotes**
1. **"Sample quote"** \`01:20:15\`
   - Context: Here.

### DIMENSION 6 – COMPARATIVE
| Dimension | Option A |
|---|---|
| Metric | Data |

### DIMENSION 7 – IMPLEMENTATION
**System: Example**
Steps here.

### DIMENSION 8 – SEMANTIC
**Primary Knowledge Graph Nodes**
- Node 1

**Cross-Domain Bridges**
- From A to B
- From C to D

### DIMENSION 9 – FORWARD INTELLIGENCE
**Contrarian Perspectives**
Alternative views here.

### DIMENSION 10 – CREDIBILITY
⚠️ **Critical Notice**: Educational only.

**Final Classification**
| Tag | Status |
|---|---|
| Authoritative | ✓ |

`;

      const report = UCISValidator.validate(completeOutput, 'test-title-author-2026-05-18_14-30-45.md');
      expect(report.passed).toBe(true);
      expect(report.failedChecks.length).toBe(0);
    });

    it('should report failed checks with reasons', () => {
      const incompleteOutput = 'Missing everything';
      const report = UCISValidator.validate(incompleteOutput, 'invalid.txt');
      expect(report.passed).toBe(false);
      expect(report.failedChecks.length).toBeGreaterThan(0);
      expect(report.failedChecks[0]?.reason).toBeDefined();
    });
  });
});
