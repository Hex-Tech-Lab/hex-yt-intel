import { describe, it, expect } from 'vitest';

import {
  STREAM_BUNDLES,
  PROJECTIVE_DIMENSIONS,
  PROJECTIVE_SUBDIMENSIONS,
  isProjectiveBundle,
} from '@/lib/config/synthesis';

describe('isProjectiveBundle (R1b epistemic split)', () => {
  it('marks ONLY the [9, 11] bundle as projective across all 5 target bundles', () => {
    const results = STREAM_BUNDLES.map((b) => isProjectiveBundle(b));
    expect(results).toEqual([false, false, false, false, true]);
  });

  it('is true iff the bundle intersects PROJECTIVE_DIMENSIONS', () => {
    expect(isProjectiveBundle([9])).toBe(true);
    expect(isProjectiveBundle([11])).toBe(true);
    expect(isProjectiveBundle([8])).toBe(false);
    expect(isProjectiveBundle([3, 8])).toBe(false);
    expect(isProjectiveBundle([])).toBe(false);
  });

  it('dim 8 is GROUNDED (ADR 008 chat grounding + ADR 022 entity seek)', () => {
    expect(PROJECTIVE_DIMENSIONS).not.toContain(8);
    // 8.3 and (R1e) 8.4 are sub-dimension-level projective, not dimension numbers.
    expect(PROJECTIVE_SUBDIMENSIONS).toEqual(['8.3', '8.4']);
  });
});
