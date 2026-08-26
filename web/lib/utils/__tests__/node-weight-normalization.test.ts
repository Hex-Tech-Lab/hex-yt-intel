import { describe, it, expect } from "vitest";
import { normalizeNodeWeight } from "../../../../worker/src/services/GraphExtractor";

describe("Node Weight Normalization (Bug #243)", () => {
  it("applies logarithmic frequency dampening and clamps between 0.1 and 1.0", () => {
    // Math.log(1 + 1) * 0.5 = 0.693 * 0.5 = 0.346
    expect(normalizeNodeWeight(1, 0.5)).toBeCloseTo(0.346, 2);

    // High relevance, low frequency
    // Math.log(1 + 1) * 1.0 = 0.693 * 1.0 = 0.693
    expect(normalizeNodeWeight(1, 1.0)).toBeCloseTo(0.693, 2);

    // Extremely high frequency with high relevance should clamp to 1.0
    expect(normalizeNodeWeight(100, 1.0)).toBe(1.0);

    // Extremely low relevance should clamp to 0.1
    expect(normalizeNodeWeight(1, 0.05)).toBe(0.1);
  });
});
