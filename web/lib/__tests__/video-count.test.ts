import { describe, it, expect } from 'vitest';
import { toCountValue, pickCount } from '@/lib/utils/video-count';

describe('toCountValue', () => {
  it('keeps numeric-string counts (the shape /api/metadata and stored payloads use)', () => {
    expect(toCountValue('20334')).toBe('20334');
    expect(toCountValue(' 344 ')).toBe('344');
  });

  it('keeps finite numbers', () => {
    expect(toCountValue(0)).toBe('0');
    expect(toCountValue(1500)).toBe('1500');
  });

  it('falls back to 0 for missing, empty or non-numeric values', () => {
    expect(toCountValue()).toBe('0');
    expect(toCountValue(null)).toBe('0');
    expect(toCountValue('')).toBe('0');
    expect(toCountValue('n/a')).toBe('0');
    expect(toCountValue(Number.NaN)).toBe('0');
  });

  it('rejects negative, fractional and radix/exponent strings', () => {
    expect(toCountValue(-5)).toBe('0');
    expect(toCountValue(1.5)).toBe('0');
    expect(toCountValue('-5')).toBe('0');
    expect(toCountValue('1.5')).toBe('0');
    expect(toCountValue('0x10')).toBe('0');
    expect(toCountValue('1e3')).toBe('0');
  });

  it('pickCount falls through invalid candidates to the next valid one', () => {
    expect(pickCount('', 'n/a', '20334')).toBe('20334');
    expect(pickCount(undefined, '0', 500)).toBe('0');
    expect(pickCount('n/a', undefined)).toBe('0');
    expect(pickCount()).toBe('0');
  });
});
