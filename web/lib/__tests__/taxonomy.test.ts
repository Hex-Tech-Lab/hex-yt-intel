import { describe, expect, it } from 'vitest';

import {
  CLASS_CODE_BY_ID,
  CLASS_ID_BY_CODE,
  JEV_STRUCTURAL_CRITERIA,
  STRUCTURAL_CLASSES,
  StructuralClass,
} from '../jev/taxonomy';

describe('S1–S6 structural taxonomy', () => {
  it('has exactly 6 classes', () => {
    expect(STRUCTURAL_CLASSES).toHaveLength(6);
  });

  it('has unique ids', () => {
    const ids = new Set(STRUCTURAL_CLASSES);
    expect(ids.size).toBe(6);
  });

  it('round-trips code ↔ id', () => {
    for (const cls of STRUCTURAL_CLASSES) {
      expect(CLASS_CODE_BY_ID[cls]).toBeTruthy();
      expect(CLASS_ID_BY_CODE[CLASS_CODE_BY_ID[cls]]).toBe(cls);
    }
    for (const code of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const) {
      expect(CLASS_ID_BY_CODE[code]).toBeDefined();
      expect(CLASS_CODE_BY_ID[CLASS_ID_BY_CODE[code]]).toBe(code);
    }
  });

  it('exports a keyed criteria record with one definition per class (Decisions API shape)', () => {
    expect(Object.keys(JEV_STRUCTURAL_CRITERIA)).toHaveLength(6);
    for (const cls of STRUCTURAL_CLASSES) {
      const def = JEV_STRUCTURAL_CRITERIA[cls];
      expect(typeof def).toBe('string');
      expect(def.length).toBeGreaterThan(0);
    }
    // typed keys match the union exactly
    const keyTypeCheck: Record<StructuralClass, string> = JEV_STRUCTURAL_CRITERIA;
    expect(Object.keys(keyTypeCheck)).toHaveLength(6);
  });

  it('uses text-observable criteria only (no audio-dependent wording)', () => {
    const text = JSON.stringify(JEV_STRUCTURAL_CRITERIA);
    expect(text).not.toMatch(/overlapping|voiceover|ambient|noise-to-signal|two distinct speakers|one primary speaker/i);
    expect(JEV_STRUCTURAL_CRITERIA.S4_procedural_screen_share).toContain('click here');
    expect(JEV_STRUCTURAL_CRITERIA.S6_unstructured_vlog).toContain('Hey guys');
  });

  it('keeps action parameters out of code', () => {
    const moduleText = JSON.stringify(JEV_STRUCTURAL_CRITERIA) + STRUCTURAL_CLASSES.join('');
    expect(moduleText).not.toMatch(/500|250/);
  });
});
