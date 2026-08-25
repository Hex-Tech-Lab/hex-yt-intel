import { describe, it, expect } from 'vitest';
import { hammingDistance, estimateCosineSimilarity } from '../simhash';

describe('SimHash Hamming Distance Matcher', () => {
  it('calculates exact bit-difference matching against synthetic 64-bit masks', () => {
    // 0 distance
    const maskA = 0b1010101010101010101010101010101010101010101010101010101010101010n;
    const maskB = 0b1010101010101010101010101010101010101010101010101010101010101010n;
    expect(hammingDistance(maskA, maskB)).toBe(0);

    // 1 bit difference
    const maskC = 0b1010101010101010101010101010101010101010101010101010101010101011n;
    expect(hammingDistance(maskA, maskC)).toBe(1);

    // 12 bit difference
    // We flip the lowest 12 zero bits of maskA to 1s.
    // maskA ends with 0. Let's flip 12 bits precisely.
    const maskD = maskA ^ 0b0000000000000000000000000000000000000000000000000000111111111111n;
    expect(hammingDistance(maskA, maskD)).toBe(12);
    
    // Check cosine similarity mapping for distance 12
    const cosSim = estimateCosineSimilarity(maskA, maskD);
    expect(cosSim).toBeGreaterThanOrEqual(0.60); // Math.cos(12 * Math.PI / 64) = Math.cos(0.589) = 0.83
    expect(cosSim).toBeLessThan(0.85);
  });
});
