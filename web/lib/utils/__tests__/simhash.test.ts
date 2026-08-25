import { describe, it, expect } from 'vitest';
import { computeSimHash64, hammingDistance, estimateCosineSimilarity } from '../simhash';

describe('SimHash Latent Semantic Compression', () => {
  it('computes deterministic 64-bit simhash', () => {
    const tokens = ['temporal', 'anchor', 'mesh', 'salient'];
    const hash1 = computeSimHash64(tokens);
    const hash2 = computeSimHash64(tokens);
    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('bigint');
  });

  it('calculates correct hamming bounds', () => {
    const hashA = 0b101010n;
    const hashB = 0b010101n;
    expect(hammingDistance(hashA, hashB)).toBe(6);
    expect(hammingDistance(hashA, hashA)).toBe(0);
  });

  it('estimates cosine similarity properly', () => {
    // distance 0 -> cos(0) = 1
    expect(estimateCosineSimilarity(0n, 0n)).toBeCloseTo(1);
    // distance 32 -> cos(pi/2) = 0
    // let's construct two hashes with 32 bits diff
    const half1 = (1n << 32n) - 1n;
    const half2 = half1 << 32n;
    expect(estimateCosineSimilarity(half1, half1 | half2)).toBeCloseTo(0);
  });
});
