/**
 * Search topK Parameter Validation Tests
 * Tests the bounds validation: 1 ≤ topK ≤ 50
 * Covers 25+ boundary, type, and special case scenarios
 */
import { describe, it, expect } from 'vitest';

function validateTopKParameter(topK: unknown): { valid: boolean; error?: string } {
  if (typeof topK !== 'number' || !Number.isInteger(topK)) {
    return { valid: false, error: 'topK must be an integer between 1 and 50' };
  }
  if (topK < 1 || topK > 50) {
    return { valid: false, error: 'topK must be an integer between 1 and 50' };
  }
  return { valid: true };
}

describe('Search topK Parameter Validation', () => {
  describe('Lower Bound Tests', () => {
    it('rejects topK = 0', () => expect(validateTopKParameter(0).valid).toBe(false));
    it('rejects topK = -1', () => expect(validateTopKParameter(-1).valid).toBe(false));
    it('rejects topK = -100', () => expect(validateTopKParameter(-100).valid).toBe(false));
  });

  describe('Upper Bound Tests', () => {
    it('rejects topK = 51', () => expect(validateTopKParameter(51).valid).toBe(false));
    it('rejects topK = 100', () => expect(validateTopKParameter(100).valid).toBe(false));
    it('rejects topK = 1000', () => expect(validateTopKParameter(1000).valid).toBe(false));
    it('rejects topK = Number.MAX_SAFE_INTEGER', () => expect(validateTopKParameter(Number.MAX_SAFE_INTEGER).valid).toBe(false));
  });

  describe('Type Validation Tests', () => {
    it('rejects topK = null', () => expect(validateTopKParameter(null).valid).toBe(false));
    it('rejects topK = undefined', () => expect(validateTopKParameter(undefined).valid).toBe(false));
    it('rejects topK as string "5"', () => expect(validateTopKParameter('5').valid).toBe(false));
    it('rejects topK as boolean', () => expect(validateTopKParameter(true).valid).toBe(false));
    it('rejects topK as object', () => expect(validateTopKParameter({}).valid).toBe(false));
    it('rejects topK as array', () => expect(validateTopKParameter([5]).valid).toBe(false));
  });

  describe('Float/Decimal Tests', () => {
    it('rejects topK = 5.5', () => expect(validateTopKParameter(5.5).valid).toBe(false));
    it('rejects topK = 1.1', () => expect(validateTopKParameter(1.1).valid).toBe(false));
    it('rejects topK = 50.1', () => expect(validateTopKParameter(50.1).valid).toBe(false));
  });

  describe('Valid Range Tests', () => {
    it('accepts topK = 1 (lower bound)', () => expect(validateTopKParameter(1).valid).toBe(true));
    it('accepts topK = 5 (default)', () => expect(validateTopKParameter(5).valid).toBe(true));
    it('accepts topK = 25 (mid-range)', () => expect(validateTopKParameter(25).valid).toBe(true));
    it('accepts topK = 50 (upper bound)', () => expect(validateTopKParameter(50).valid).toBe(true));
  });

  describe('Special Cases', () => {
    it('rejects topK = NaN', () => expect(validateTopKParameter(NaN).valid).toBe(false));
    it('rejects topK = Infinity', () => expect(validateTopKParameter(Infinity).valid).toBe(false));
    it('rejects topK = -Infinity', () => expect(validateTopKParameter(-Infinity).valid).toBe(false));
  });

  describe('Error Message Clarity', () => {
    it('error message includes bounds', () => {
      const result = validateTopKParameter(100);
      expect(result.error).toContain('1');
      expect(result.error).toContain('50');
    });
  });

  describe('Boundary Edge Cases', () => {
    it('accepts all integers from 1 to 50', () => {
      for (let i = 1; i <= 50; i++) {
        expect(validateTopKParameter(i).valid).toBe(true);
      }
    });

    it('rejects all integers from 51 to 60', () => {
      for (let i = 51; i <= 60; i++) {
        expect(validateTopKParameter(i).valid).toBe(false);
      }
    });
  });
});
