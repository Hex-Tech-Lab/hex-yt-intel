import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { UCIS_V5_3_SYSTEM, UCIS_PERSON_CREDIBILITY_GROUNDING } from './ucis-v5.3';

/**
 * Regression coverage for the 2026-08-20 KG weight-field guidance fix
 * (GitHub #243): the prompt gave the LLM no criteria for the KG node
 * `weight` field, and a follow-up fix corrected a real sequencing bug
 * (weight partly depends on 8.2 connection count, which didn't exist yet
 * when 8.1 was drafted). Asserts the guidance text is actually present in
 * the constant AND that this constant is the one PromptBuilder.ts actually
 * uses as its live fallback -- not just checking the string in isolation.
 */
describe('UCIS_V5_3_SYSTEM — KG weight-field guidance (#243)', () => {
  it('gives concrete, non-frequency-first weight-scoring criteria', () => {
    expect(UCIS_V5_3_SYSTEM).toContain('Explanatory depth/duration');
    expect(UCIS_V5_3_SYSTEM).toContain('Foundational/prerequisite role');
    expect(UCIS_V5_3_SYSTEM).toContain('WEAK, LAST-RESORT signal only');
  });

  it('sequences connection-count scoring after relations are drafted, not before', () => {
    expect(UCIS_V5_3_SYSTEM).toContain(
      'First mentally draft the full candidate relation set (8.2)'
    );
    expect(UCIS_V5_3_SYSTEM).toContain('SECONDARY, CAPPED signal only');
    expect(UCIS_V5_3_SYSTEM).toContain('Never invent a connection count');
  });

  it('requires an integer weight and allows ties on small/comparable candidate sets', () => {
    expect(UCIS_V5_3_SYSTEM).toContain('an INTEGER from 1 to 10 inclusive');
    expect(UCIS_V5_3_SYSTEM).toContain('permit ties');
  });

  it('is the constant PromptBuilder.ts actually imports as its live fallback', () => {
    const promptBuilderSource = readFileSync(
      new URL('../../../worker/src/services/PromptBuilder.ts', import.meta.url),
      'utf-8'
    );
    expect(promptBuilderSource).toContain("from '../../../web/lib/prompts/ucis-v5.3'");
    expect(promptBuilderSource).toContain('UCIS_V5_3_SYSTEM');
  });
});

/**
 * PR #318 round 2: person-credibility grounding rules ("Jason Nadak"
 * hallucinated-expert incident). Guards the narrowed/extended 2.3/4.2
 * prompt language so a future edit cannot silently regress it, plus the
 * P0 DeepSource JS-0097 fix (unnecessary `\$` escapes in template literal).
 */
describe('UCIS_V5_3_SYSTEM — person-credibility grounding (PR #318)', () => {
  it('2.3 prohibits inventing OR embellishing every attribute, traceable to 2.1/transcript only', () => {
    const section23 = UCIS_V5_3_SYSTEM.slice(
      UCIS_V5_3_SYSTEM.indexOf('#### 2.3'),
      UCIS_V5_3_SYSTEM.indexOf('#### 2.4')
    );
    expect(section23).toContain('NEVER invent OR embellish');
    expect(section23.replace(/\s+/g, ' ')).toContain('names, titles, roles, affiliations, and credentials');
    expect(section23.replace(/\s+/g, ' ')).toContain('established in 2.1 or directly observed in the transcript');
  });

  it('4.2 is narrowed to 2.1/transcript only — never other generated dimensions', () => {
    const section42 = UCIS_V5_3_SYSTEM.slice(
      UCIS_V5_3_SYSTEM.indexOf('#### 4.2'),
      UCIS_V5_3_SYSTEM.indexOf('#### 4.3')
    );
    expect(section42).toContain('ONLY names/roles/credentials explicitly present in Dimension 2.1 or directly');
    expect(section42).toContain('GENERATED');
    expect(section42).toContain('omit the name');
  });

  it('contains no unnecessary dollar escapes (DeepSource JS-0097 P0)', () => {
    expect(UCIS_V5_3_SYSTEM).not.toMatch(/\\\$/);
  });

  it('exports the canonical grounding block that getUCISPrompt appends to every resolution path', () => {
    expect(UCIS_PERSON_CREDIBILITY_GROUNDING).toContain('Never invent OR embellish');
    expect(UCIS_PERSON_CREDIBILITY_GROUNDING).toContain('name, title, role, affiliation, or credential');
    expect(UCIS_PERSON_CREDIBILITY_GROUNDING).toContain('GENERATED');
    expect(UCIS_PERSON_CREDIBILITY_GROUNDING).toContain('omit the name entirely');
    expect(UCIS_PERSON_CREDIBILITY_GROUNDING).not.toMatch(/\\\$/);

    const factorySource = readFileSync(
      new URL('./factory.ts', import.meta.url),
      'utf-8'
    );
    expect(factorySource).toContain('UCIS_PERSON_CREDIBILITY_GROUNDING');
    expect(factorySource.match(/groundingBlock/g)?.length).toBeGreaterThanOrEqual(3); // definition + both return branches
  });
});
