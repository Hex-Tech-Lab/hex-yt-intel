import { describe, it, expect } from 'vitest';
import { canonicalJson } from '@/lib/utils/canonical-json';

describe('canonicalJson', () => {
  it('is independent of key order at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: [2, { y: 2, z: 1 }] }, b: 1 }));
  });
  it('keeps array order and drops undefined members', () => {
    expect(canonicalJson({ list: [3, 1, 2], gone: undefined })).toBe('{"list":[3,1,2]}');
  });
  it('changes when any nested value changes', () => {
    expect(canonicalJson({ insights: { sentiment: { positive: 81 } } })).not.toBe(canonicalJson({ insights: { sentiment: { positive: 82 } } }));
  });
});
