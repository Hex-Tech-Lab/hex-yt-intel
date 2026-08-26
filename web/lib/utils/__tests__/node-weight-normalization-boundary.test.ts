import { describe, it, expect } from "vitest";
import { normalizeNodeWeight } from "../node-weight-normalization";

describe("normalizeNodeWeight boundaries", () => {
  it("handles raw integer weights (e.g. 8) and normalized floats (e.g. 0.8) idempotently", () => {
    // Math.log(1+1) * (8/10) = ~0.693 * 0.8 = ~0.554
    const integerWeight = normalizeNodeWeight(1, 8);
    // Math.log(1+1) * 0.8 = ~0.693 * 0.8 = ~0.554
    const floatWeight = normalizeNodeWeight(1, 0.8);
    
    expect(integerWeight).toBeCloseTo(floatWeight);
    expect(integerWeight).toBeGreaterThan(0.1);
  });

  it("sanitizes NaN, null, negative numbers, and boundary extremes without throwing", () => {
    // @ts-ignore
    expect(normalizeNodeWeight(NaN, 5)).toBeGreaterThanOrEqual(0.1);
    // @ts-ignore
    expect(normalizeNodeWeight(1, null)).toBeGreaterThanOrEqual(0.1);
    expect(normalizeNodeWeight(-5, 5)).toBeGreaterThanOrEqual(0.1); // negative frequency
    expect(normalizeNodeWeight(1, -5)).toBeGreaterThanOrEqual(0.1); // negative relevance
    expect(normalizeNodeWeight(Infinity, Infinity)).toBeGreaterThanOrEqual(0.1);
  });
});
