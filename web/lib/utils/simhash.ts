export function simpleStringHash(str: string): bigint {
  let hash = 14695981039346656037n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash;
}

export function computeSimHash64(tokens: string[]): bigint {
  const hashBits = new Array(64).fill(0);
  
  for (const token of tokens) {
    const hash = simpleStringHash(token);
    for (let i = 0; i < 64; i++) {
      if ((hash >> BigInt(i)) & 1n) {
        hashBits[i]++;
      } else {
        hashBits[i]--;
      }
    }
  }

  let finalHash = 0n;
  for (let i = 0; i < 64; i++) {
    if (hashBits[i] > 0) {
      finalHash |= (1n << BigInt(i));
    }
  }
  
  return BigInt.asUintN(64, finalHash);
}

export function hammingDistance(a: bigint, b: bigint): number {
  let xor = BigInt.asUintN(64, a ^ b);
  let dist = 0;
  while (xor > 0n) {
    dist += Number(xor & 1n);
    xor >>= 1n;
  }
  return dist;
}

export function estimateCosineSimilarity(a: bigint, b: bigint): number {
  const dist = hammingDistance(a, b);
  return Math.cos(Math.PI * dist / 64);
}
