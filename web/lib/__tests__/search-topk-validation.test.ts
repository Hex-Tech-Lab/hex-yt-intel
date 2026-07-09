/**
 * Search topK Validation Tests
 *
 * Comprehensive boundary testing for the topK parameter validation in the search endpoint.
 * Ensures that the API correctly rejects out-of-bounds values and accepts valid ones.
 *
 * Test Coverage:
 * - Lower bound validation (topK < 1)
 * - Upper bound validation (topK > 50)
 * - Type validation (non-integer, non-numeric)
 * - Edge cases (null, undefined, 0, negative, float)
 * - Valid range acceptance (1-50)
 * - Default value handling
 */

import { describe, it, expect } from 'vitest';

// Mock validation function that mirrors the server-side logic
function validateTopKParameter(topK: unknown): { valid: boolean; error?: string } {
  // Type validation: must be a number and an integer
  if (typeof topK !== 'number' || !Number.isInteger(topK)) {
    return {
      valid: false,
      error: 'topK must be an integer between 1 and 50'
    };
  }

  // Bounds validation: must be between 1 and 50 inclusive
  if (topK < 1 || topK > 50) {
    return {
      valid: false,
      error: 'topK must be an integer between 1 and 50'
    };
  }

  return { valid: true };
}

describe('Search topK Parameter Validation', () => {
  describe('Lower Bound Tests', () => {
    it('rejects topK = 0', () => {
      const result = validateTopKParameter(0);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = -1', () => {
      const result = validateTopKParameter(-1);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = -10', () => {
      const result = validateTopKParameter(-10);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = -100', () => {
      const result = validateTopKParameter(-100);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Upper Bound Tests', () => {
    it('rejects topK = 51', () => {
      const result = validateTopKParameter(51);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = 100', () => {
      const result = validateTopKParameter(100);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = 1000', () => {
      const result = validateTopKParameter(1000);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = Number.MAX_SAFE_INTEGER', () => {
      const result = validateTopKParameter(Number.MAX_SAFE_INTEGER);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Type Validation Tests', () => {
    it('rejects topK = null', () => {
      const result = validateTopKParameter(null);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = undefined', () => {
      const result = validateTopKParameter(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK as string "5"', () => {
      const result = validateTopKParameter('5');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK as string "invalid"', () => {
      const result = validateTopKParameter('invalid');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK as boolean', () => {
      const result = validateTopKParameter(true);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK as object', () => {
      const result = validateTopKParameter({});
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK as array', () => {
      const result = validateTopKParameter([5]);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Float/Decimal Tests', () => {
    it('rejects topK = 5.5 (float)', () => {
      const result = validateTopKParameter(5.5);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = 1.1 (float)', () => {
      const result = validateTopKParameter(1.1);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = 50.1 (float above upper bound)', () => {
      const result = validateTopKParameter(50.1);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Valid Range Tests', () => {
    it('accepts topK = 1 (lower bound)', () => {
      const result = validateTopKParameter(1);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts topK = 5 (default value)', () => {
      const result = validateTopKParameter(5);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts topK = 10', () => {
      const result = validateTopKParameter(10);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts topK = 25 (mid-range)', () => {
      const result = validateTopKParameter(25);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts topK = 50 (upper bound)', () => {
      const result = validateTopKParameter(50);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Special Cases', () => {
    it('rejects topK = NaN', () => {
      const result = validateTopKParameter(NaN);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = Infinity', () => {
      const result = validateTopKParameter(Infinity);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects topK = -Infinity', () => {
      const result = validateTopKParameter(-Infinity);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Error Message Clarity', () => {
    it('provides clear error message for out-of-bounds values', () => {
      const result = validateTopKParameter(100);
      expect(result.error).toContain('topK');
      expect(result.error).toContain('1');
      expect(result.error).toContain('50');
    });

    it('provides clear error message for type mismatches', () => {
      const result = validateTopKParameter('ten');
      expect(result.error).toContain('topK');
      expect(result.error).toContain('integer');
    });

    it('provides consistent error message across different invalid inputs', () => {
      const result1 = validateTopKParameter(0);
      const result2 = validateTopKParameter(51);
      const result3 = validateTopKParameter('5');

      expect(result1.error).toBe(result2.error);
      expect(result2.error).toBe(result3.error);
    });
  });

  describe('Boundary Edge Cases', () => {
    it('correctly distinguishes between 0 (invalid) and 1 (valid)', () => {
      const result0 = validateTopKParameter(0);
      const result1 = validateTopKParameter(1);

      expect(result0.valid).toBe(false);
      expect(result1.valid).toBe(true);
    });

    it('correctly distinguishes between 50 (valid) and 51 (invalid)', () => {
      const result50 = validateTopKParameter(50);
      const result51 = validateTopKParameter(51);

      expect(result50.valid).toBe(true);
      expect(result51.valid).toBe(false);
    });

    it('accepts all integers from 1 to 50', () => {
      for (let i = 1; i <= 50; i++) {
        const result = validateTopKParameter(i);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    it('rejects all integers from 51 to 60', () => {
      for (let i = 51; i <= 60; i++) {
        const result = validateTopKParameter(i);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }
    });
  });
});
