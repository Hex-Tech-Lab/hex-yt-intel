/**
 * ValidationService — Dimension boundary matching regression tests.
 * Verifies DIMENSION 10 does NOT false-match DIMENSION 1 via substring.
 */
import { describe, it, expect } from 'vitest';
import { ValidationService } from '../services/ValidationService';

describe('ValidationService — Dimension boundary matching', () => {
  const validator = new ValidationService();

  it('DIMENSION 10 should NOT match when only DIMENSION 1 is checked', () => {
    const output = `### DIMENSION 10 – EXTERNAL SIGNALS
Content for dimension 10.
### DIMENSION 11 – MONETIZATION
Content for dimension 11.`;

    // With targetCount=1, needs 1 match. DIMENSION 10 should NOT match DIMENSION 1.
    const result = validator.validate12D(output, 1);
    expect(result).toBe(false);
  });

  it('DIMENSION 1 should match when present', () => {
    const output = `### DIMENSION 1 – APEX INTELLIGENCE
Content for dimension 1.
### DIMENSION 2 – PROVENANCE
Content for dimension 2.`;

    const result = validator.validate12D(output, 2);
    expect(result).toBe(true);
  });

  it('DIMENSION 1 and DIMENSION 10 should both match independently', () => {
    const output = `### DIMENSION 1 – APEX INTELLIGENCE
Content for dimension 1.
### DIMENSION 10 – EXTERNAL SIGNALS
Content for dimension 10.`;

    const result = validator.validate12D(output, 2);
    expect(result).toBe(true);
  });

  it('clamps expectedCount to positive integer', () => {
    const output = `### DIMENSION 1 – APEX INTELLIGENCE
Content.`;

    // expectedCount=0 or negative → clamped to default 8, only 1 dim present
    expect(validator.validate12D(output, 0)).toBe(false);
    expect(validator.validate12D(output, -5)).toBe(false);
  });
});
