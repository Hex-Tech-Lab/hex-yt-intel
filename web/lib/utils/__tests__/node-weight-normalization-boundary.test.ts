import { describe, it, expect } from "vitest";
import { normalizeNodeWeight } from "../node-weight-normalization";

describe("normalizeNodeWeight boundaries", () => {
  it("handles raw integer weights (e.g. 8) and normalized floats (e.g. 0.8) idempotently", () => {
    // Math.log2(1+1) * (8/10) = 1 * 0.8 = 0.8
    const integerWeight = normalizeNodeWeight(1, 8);
    // Math.log2(1+1) * 0.8 = 1 * 0.8 = 0.8
    const floatWeight = normalizeNodeWeight(1, 0.8);
    
    expect(integerWeight).toBeCloseTo(floatWeight);
    expect(integerWeight).toBeGreaterThan(0.1);
  });

  it("sanitizes NaN, null, negative numbers, and boundary extremes without throwing", () => {
    // NaN is a valid number type in TS, no expect-error needed
    expect(normalizeNodeWeight(NaN, 5)).toBeGreaterThanOrEqual(0.1);
    // @ts-expect-error testing boundaries for null
    expect(normalizeNodeWeight(1, null)).toBeGreaterThanOrEqual(0.1);
    expect(normalizeNodeWeight(-5, 5)).toBeGreaterThanOrEqual(0.1); // negative frequency
    expect(normalizeNodeWeight(1, -5)).toBeGreaterThanOrEqual(0.1); // negative relevance
  });

  it("never exceeds 1.0 even with high frequency and high relevance", () => {
    expect(normalizeNodeWeight(100, 10)).toBeLessThanOrEqual(1.0);
    expect(normalizeNodeWeight(Infinity, Infinity)).toBeLessThanOrEqual(1.0);
  });

  it("repeated entity occurrences yield higher weights than singleton entities", () => {
    const singletonWeight = normalizeNodeWeight(1, 5); // f=1
    const repeatedWeight = normalizeNodeWeight(3, 5);  // f=3
    expect(repeatedWeight).toBeGreaterThan(singletonWeight);
  });
});
