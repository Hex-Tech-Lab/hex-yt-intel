import { describe, it, expect } from 'vitest';
import {
  extractPresenterNames,
  flagUnsupportedPersonNames,
  stripUnsupportedPersonNames,
} from './credibility-grounding';

/**
 * PR #318 round 2, item 5: machine-checkable post-generation validation for
 * the person-credibility grounding rules. The "Jason Nadak" incident shape:
 * a transcript with no named experts, presenter unnamed, yet a GENERATED
 * dimension 2.3/4.2 introduces a named authority.
 */

const TRANSCRIPT =
  'so the first thing you want to do is cache your dependencies. most people skip this step. the next trick is parallelizing your test runner. i learned this the hard way after a three hour build. that is really the whole point of this video.';

const ANALYSIS = `### DIMENSION 2

#### 2.1 Header Intelligence

| Field | Value |
|---|---|
| Title | Why Your CI Pipeline Is Slow |
| Creator / Presenter | DevOps Corner channel |
| Channel | DevOps Corner |
| Duration | 00:17:22 |

#### 2.3 Channel Authority Assessment

- Credibility score: 6/10. Practitioner-led channel with strong
  demonstrated expertise. According to Jason Nadak, a principal
  infrastructure engineer, this approach reduces build times by 60%.
- Upload cadence: weekly.

#### 2.4 Audience Sentiment Prediction

- Positive sentiment expected.

#### 4.1 Sentiment & Tonal Profile

- Confident, practitioner tone.

#### 4.2 Persuasion Strategy

Primary mode: Authority. Hook architecture opens with a relatable pain
point. Uses authority transfer citing Jason Nadak, a principal
infrastructure engineer at Northwind Labs.

#### 4.3 Bias Detection

- Practitioner bias, low promotional content.
`;

describe('credibility-grounding validator', () => {
  it('extracts presenter names from the 2.1 row', () => {
    expect(extractPresenterNames(ANALYSIS)).toEqual(['DevOps Corner channel']);
  });

  it('flags an unsupported named expert in 2.3 and 4.2 (Jason Nadak incident shape)', () => {
    const violations = flagUnsupportedPersonNames(ANALYSIS, TRANSCRIPT);
    const names = violations.map((v) => v.name);
    expect(violations.length).toBeGreaterThan(0);
    expect(names.some((n) => n.includes('Jason Nadak'))).toBe(true);
    expect(names.some((n) => n.includes('Northwind Labs'))).toBe(true);
  });

  it('does not flag names established in 2.1', () => {
    const supported = ANALYSIS.replace(
      'According to Jason Nadak, a principal\n  infrastructure engineer, this approach reduces build times by 60%.',
      'According to DevOps Corner channel, this approach reduces build times by 60%.'
    ).replace(
      'authority transfer citing Jason Nadak, a principal\ninfrastructure engineer at Northwind Labs.',
      'authority transfer citing DevOps Corner channel, the creator.'
    );
    expect(flagUnsupportedPersonNames(supported, TRANSCRIPT)).toEqual([]);
  });

  it('does not flag names present in the transcript', () => {
    const withNamedGuest = ANALYSIS.replace('Jason Nadak', 'Rust Zagreus');
    const transcript = `today my guest Rust Zagreus joins me. ${TRANSCRIPT}`;
    const violations = flagUnsupportedPersonNames(withNamedGuest, transcript);
    const names = violations.map((v) => v.name);
    expect(names.some((n) => n.includes('Rust Zagreus'))).toBe(false);
    expect(names.some((n) => n.includes('Northwind Labs'))).toBe(true); // affiliation still unsupported
  });

  it('strips flagged names with a redaction marker', () => {
    const stripped = stripUnsupportedPersonNames(ANALYSIS, TRANSCRIPT);
    expect(stripped).not.toContain('Jason Nadak');
    expect(stripped).not.toContain('Northwind Labs');
    expect(stripped).toContain('[unsupported attribution removed]');
    expect(flagUnsupportedPersonNames(stripped, TRANSCRIPT)).toEqual([]);
  });

  it('returns no violations for an analysis without 2.3/4.2 person mentions', () => {
    const clean = ANALYSIS
      .replace(/According to Jason Nadak[\s\S]*?60%./, 'Practitioner-led channel.')
      .replace(/Uses authority transfer[\s\S]*?Northwind Labs\./, 'Authority mode throughout.');
    expect(flagUnsupportedPersonNames(clean, TRANSCRIPT)).toEqual([]);
  });
});
