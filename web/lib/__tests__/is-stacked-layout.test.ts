import { describe, it, expect } from 'vitest';
import { useIsStackedLayout } from '@/hooks/useIsStackedLayout';

describe('useIsStackedLayout', () => {
  it('module exports useIsStackedLayout function', () => {
    expect(typeof useIsStackedLayout).toBe('function');
  });
});
