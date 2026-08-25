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

  it('correctly handles DB round-trips for hashes with bit 63 set (Postgres negative BIGINT)', () => {
    // A hash with bit 63 set. Unsigned it's huge, signed it's negative.
    const unsignedHash = 0b1000000000000000000000000000000000000000000000000000000000000001n;
    
    // Adapter converts to signed string for DB
    const dbString = BigInt.asIntN(64, unsignedHash).toString();
    expect(dbString.startsWith('-')).toBe(true);
    
    // Postgres returns the string, adapter converts back to unsigned
    const backToUnsigned = BigInt.asUintN(64, BigInt(dbString));
    expect(backToUnsigned).toBe(unsignedHash);
    
    // Ensure hamming distance works for two high-bit hashes
    const hash2 = 0b1000000000000000000000000000000000000000000000000000000000000011n;
    expect(hammingDistance(unsignedHash, hash2)).toBe(1);
  });
