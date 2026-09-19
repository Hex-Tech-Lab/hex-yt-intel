import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../services/PromptBuilder';
import { UCIS_PERSON_CREDIBILITY_GROUNDING } from '../../../web/lib/prompts/ucis-v5.3';
import type { PromptConfigPort } from '../../ports/PromptConfigPort';
import type { EngineContext } from '../../ports/ReasoningEnginePort';

/**
 * PR #318 round 2: the 2.3/4.2 person-credibility grounding rules must
 * survive EVERY prompt-resolution path. PromptBuilder resolves either the
 * embedded UCIS_V5_3_SYSTEM default (promptConfig absent/unset) or a
 * DB/Redis template via resolvePromptTemplate() — both go through
 * getUCISPrompt, which appends UCIS_PERSON_CREDIBILITY_GROUNDING to the
 * assembled prompt. These tests prove the guard text reaches the final
 * prompt in each case, plus a MoBr0nQtOnA-shaped regression fixture
 * (transcript with NO named experts — the "Jason Nadak" incident shape).
 */

const GROUNDING_ASSERTIONS = [
  'PERSON-CREDIBILITY GROUNDING',
  'Never invent OR embellish',
  'name, title, role, affiliation, or credential',
  'Dimension 2.1',
  'GENERATED',
  'omit the name',
];

function expectGrounded(prompt: string): void {
  for (const fragment of GROUNDING_ASSERTIONS) {
    expect(prompt).toContain(fragment);
  }
}

function makeContext(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    videoId: 'MoBr0nQtOnA',
    metadata: {
      title: 'Why Your CI Pipeline Is Slow (And How To Fix It)',
      channelTitle: 'DevOps Corner',
      viewCount: 42000,
      likeCount: 1800,
      commentCount: 240,
      publishedAt: '2026-08-01T10:00:00Z',
      duration: 1042,
    },
    transcript: 'so the first thing you want to do is cache your dependencies. most people skip this step entirely. the next trick is parallelizing your test runner across containers. i learned this the hard way after a three hour build. remember, the problem is never the hardware, it is the serial execution model. that is really the whole point of this video.',
    persona: 'creator',
    timezone: 'UTC',
    dimensions: [2, 4],
    ...overrides,
  } as EngineContext;
}

// DB/Redis-style template: deliberately lacks ALL inline 2.3/4.2 grounding
// language, proving only the injected block carries the guard.
const DB_TEMPLATE =
  'You are a video analyst. Produce the UCIS report for the provided transcript. Output strict JSON.';

describe('PromptBuilder — person-credibility grounding survives every resolution path (PR #318)', () => {
  it('default path (no promptConfig): embedded template + appended grounding block', async () => {
    const prompt = await new PromptBuilder().build(makeContext());
    expect(prompt).toContain('PERSON-CREDIBILITY GROUNDING');
    expectGrounded(prompt);
  });

  it('DB/Redis template path: custom template via resolvePromptTemplate still gets the grounding block', async () => {
    const promptConfig: PromptConfigPort = {
      resolvePromptTemplate: () => Promise.resolve(DB_TEMPLATE),
    } as unknown as PromptConfigPort;
    const prompt = await new PromptBuilder(promptConfig).build(makeContext());
    expect(prompt).toContain('You are a video analyst');
    expect(prompt).not.toContain('#### 2.3 Channel Authority Assessment'); // DB template replaced embedded text
    expectGrounded(prompt);
    // Full canonical block text present verbatim (imported constant).
    expect(prompt).toContain(UCIS_PERSON_CREDIBILITY_GROUNDING);
  });

  it('segmented-dimension path: grounding block still present alongside segment instructions', async () => {
    // The worker's segmented path appends its instruction block after the
    // base prompt; this proves the grounding block is present in the final
    // assembled prompt either way (base prompt carries it).
    const prompt = await new PromptBuilder().build(makeContext({ dimensions: [2, 3, 4] }));
    expectGrounded(prompt);
    expect(prompt).toContain('CRITICAL INSTRUCTION FOR THIS SEGMENT ANALYSIS');
    expect(prompt.indexOf('PERSON-CREDIBILITY GROUNDING')).toBeGreaterThan(
      prompt.indexOf('**Transcript**')
    );
  });

  it('MoBr0nQtOnA-shaped fixture: assembled prompt carries every guard for that resolution path', async () => {
    // Real incident shape: presenter gives no name, no credentials, no
    // guests — the model previously invented "Jason Nadak". The fixture
    // asserts the assembled prompt (default path) contains all required
    // guards so an unsupported named-expert claim has nowhere to come from.
    const prompt = await new PromptBuilder().build(makeContext());
    expectGrounded(prompt);
    expect(prompt).toContain('## PERSON-CREDIBILITY GROUNDING (non-negotiable, overrides every dimension)');
    expect(prompt).toContain('authority transfer');
    expect(prompt).toContain('traceable to 2.1 or the transcript');
  });
});
