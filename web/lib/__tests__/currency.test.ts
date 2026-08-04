import { describe, it, expect } from 'vitest';
import { fmtUsd, fmtUsdPrecise, fmtCentsToUsd } from '@/lib/utils/currency';

describe('fmtUsd', () => {
  it('formats zero', () => {
    expect(fmtUsd(0)).toBe('$0.00');
  });

  it('formats a normal positive amount at 2 decimals', () => {
    expect(fmtUsd(5.25)).toBe('$5.25');
  });

  it('formats a sub-cent positive amount at 4 decimals', () => {
    expect(fmtUsd(0.0042)).toBe('$0.0042');
  });

  it('formats a micro amount below the display floor', () => {
    expect(fmtUsd(0.00001)).toBe('<$0.0001');
  });

  it('preserves sign and magnitude for a negative amount (refund/adjustment)', () => {
    expect(fmtUsd(-5.25)).toBe('-$5.25');
  });

  it('preserves sign for a negative micro amount', () => {
    expect(fmtUsd(-0.00001)).toBe('-<$0.0001');
  });

  it('does not render the literal string "$NaN" for non-finite input', () => {
    expect(fmtUsd(NaN)).toBe('—');
    expect(fmtUsd(Infinity)).toBe('—');
    expect(fmtUsd(-Infinity)).toBe('—');
  });
});

describe('fmtUsdPrecise', () => {
  it('always uses 4 decimals for a positive amount', () => {
    expect(fmtUsdPrecise(5.25)).toBe('$5.2500');
  });

  it('preserves sign for a negative amount', () => {
    expect(fmtUsdPrecise(-5.25)).toBe('-$5.2500');
  });

  it('does not render "$NaN" for non-finite input', () => {
    expect(fmtUsdPrecise(NaN)).toBe('—');
  });
});

describe('fmtCentsToUsd', () => {
  it('converts cents to USD before formatting', () => {
    expect(fmtCentsToUsd(525)).toBe('$5.25');
  });

  it('preserves sign for a negative cents value (refund)', () => {
    expect(fmtCentsToUsd(-525)).toBe('-$5.25');
  });

  it('handles zero cents', () => {
    expect(fmtCentsToUsd(0)).toBe('$0.00');
  });
});
