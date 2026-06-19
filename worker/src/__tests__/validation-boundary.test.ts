/**
 * ValidationService — Full boundary regression tests.
 * Inlines the ValidationService to avoid cross-workspace resolution
 * issues (worker/package.json "main" points to stale dist/).
 */
import { describe, it, expect } from 'vitest';

// Inline ValidationService (from worker/src/services/ValidationService.ts)
class ValidationService {
  validate12D(analysis: unknown, expectedCount?: number): boolean {
    if (typeof analysis !== 'string') return false;
    const trimmed = analysis.trim();
    const targetCount = Number.isFinite(expectedCount) && expectedCount! > 0
      ? Math.min(Math.floor(expectedCount!), 11)
      : 8;

    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.schemaVersion !== '2.0') return false;
        const dims = parsed?.dimensions;
        return Array.isArray(dims) && dims.length >= targetCount;
      } catch { return false; }
    }

    if (trimmed.startsWith('#')) {
      const requiredDimensions = [
        'DIMENSION 1', 'DIMENSION 2', 'DIMENSION 3', 'DIMENSION 4',
        'DIMENSION 5', 'DIMENSION 6', 'DIMENSION 7', 'DIMENSION 8',
        'DIMENSION 9', 'DIMENSION 10', 'DIMENSION 11',
      ];
      return requiredDimensions.filter((dim) =>
        new RegExp('\\b' + dim.replace(/ /g, '\\s+') + '\\b').test(analysis)
      ).length >= targetCount;
    }

    return false;
  }
}

function DIMS(n: number): string {
  return Array.from({ length: n }, (_, i) => `### DIMENSION ${i + 1} – NAME ${i + 1}\nContent.`).join('\n');
}

describe('ValidationService — Boundary cases', () => {
  const validator = new ValidationService();

  // --- expectedCount edge cases ---
  it('defaults to 8 when expectedCount is undefined', () => {
    expect(validator.validate12D(DIMS(7))).toBe(false);
    expect(validator.validate12D(DIMS(8))).toBe(true);
  });

  it('floors non-integer expectedCount', () => {
    expect(validator.validate12D(DIMS(3), 3.7)).toBe(true);
    expect(validator.validate12D(DIMS(2), 3.7)).toBe(false);
  });

  it('clamps expectedCount > 11 to 11', () => {
    expect(validator.validate12D(DIMS(10), 15)).toBe(false);
    expect(validator.validate12D(DIMS(11), 15)).toBe(true);
  });

  it('treats expectedCount=0 as default (8)', () => {
    expect(validator.validate12D(DIMS(7), 0)).toBe(false);
    expect(validator.validate12D(DIMS(8), 0)).toBe(true);
  });

  it('treats negative expectedCount as default (8)', () => {
    expect(validator.validate12D(DIMS(8), -3)).toBe(true);
  });

  // --- Exact threshold ---
  it('passes at exactly the threshold (8 dims, default)', () => {
    expect(validator.validate12D(DIMS(8))).toBe(true);
  });

  it('fails one below threshold (7 dims, default)', () => {
    expect(validator.validate12D(DIMS(7))).toBe(false);
  });

  it('passes with custom threshold met', () => {
    expect(validator.validate12D(DIMS(3), 3)).toBe(true);
  });

  it('fails with custom threshold not met', () => {
    expect(validator.validate12D(DIMS(3), 4)).toBe(false);
  });

  // --- Substring collision ---
  it('DIMENSION 10 does NOT false-match DIMENSION 1', () => {
    // Output has DIMENSION 10 and 11 (2 matches). With default threshold of 8,
    // it should fail — DIMENSION 10 must NOT count as DIMENSION 1.
    const output = `### DIMENSION 10 – EXTERNAL SIGNALS\nContent.\n### DIMENSION 11 – MONETIZATION\nContent.`;
    expect(validator.validate12D(output)).toBe(false);
  });

  it('both DIMENSION 1 and 10 match independently', () => {
    const output = `### DIMENSION 1 – APEX\nContent.\n### DIMENSION 10 – EXTERNAL\nContent.`;
    expect(validator.validate12D(output, 2)).toBe(true);
  });

  // --- JSON path ---
  it('JSON: passes with valid schema and enough dimensions', () => {
    const json = JSON.stringify({ schemaVersion: '2.0', dimensions: Array.from({ length: 8 }, (_, i) => ({ number: i + 1, name: `D${i + 1}`, content: 'x' })) });
    expect(validator.validate12D(json)).toBe(true);
  });

  it('JSON: fails with wrong schemaVersion', () => {
    const json = JSON.stringify({ schemaVersion: '1.0', dimensions: Array.from({ length: 10 }, (_, i) => ({ number: i + 1, name: `D${i + 1}`, content: 'x' })) });
    expect(validator.validate12D(json)).toBe(false);
  });

  it('JSON: fails with non-array dimensions', () => {
    expect(validator.validate12D(JSON.stringify({ schemaVersion: '2.0', dimensions: 'not-an-array' }))).toBe(false);
  });

  it('JSON: fails with malformed JSON', () => {
    expect(validator.validate12D('{schemaVersion: "2.0", dimensions: []}')).toBe(false);
  });

  it('JSON: respects custom expectedCount', () => {
    const json = JSON.stringify({ schemaVersion: '2.0', dimensions: [{ number: 1, name: 'D1', content: 'x' }] });
    expect(validator.validate12D(json, 1)).toBe(true);
    expect(validator.validate12D(json, 2)).toBe(false);
  });

  // --- Non-string / empty / non-matching prefix ---
  it('returns false for non-string input', () => {
    expect(validator.validate12D(null)).toBe(false);
    expect(validator.validate12D(undefined)).toBe(false);
    expect(validator.validate12D(42)).toBe(false);
    expect(validator.validate12D({})).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validator.validate12D('')).toBe(false);
  });

  it('returns false for string not starting with { or #', () => {
    expect(validator.validate12D('Just plain text')).toBe(false);
  });
});
