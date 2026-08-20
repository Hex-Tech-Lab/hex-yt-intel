import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { UCIS_V5_3_SYSTEM } from './ucis-v5.3';

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
