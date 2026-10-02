import { describe, it, expect, vi } from 'vitest';
import { runWithConcurrency } from '@/lib/utils/run-with-concurrency';

describe('runWithConcurrency', () => {
  it('handles empty input array immediately', async () => {
    const fn = vi.fn();
    const results = await runWithConcurrency([], 5, fn);
    expect(results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('never exceeds the concurrency cap', async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const cap = 3;

    const results = await runWithConcurrency(items, cap, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return item * 2;
    });

    expect(maxActive).toBeLessThanOrEqual(cap);
    expect(maxActive).toBe(cap);
    expect(results).toHaveLength(items.length);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('preserves result order matching input items', async () => {
    const delays = [40, 10, 30, 5, 20];
    const items = ['a', 'b', 'c', 'd', 'e'];

    const results = await runWithConcurrency(items, 3, async (item, idx) => {
      await new Promise((resolve) => setTimeout(resolve, delays[idx]));
      return `${item}-${idx}`;
    });

    const values = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    expect(values).toEqual(['a-0', 'b-1', 'c-2', 'd-3', 'e-4']);
  });

  it('does not stop other tasks if one task rejects', async () => {
    const items = [1, 2, 3, 4, 5];

    const results = await runWithConcurrency(items, 2, (item) =>
      item === 3 ? Promise.reject(new Error('fail-item-3')) : Promise.resolve(item * 10)
    );

    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 10 });
    expect(results[1]).toEqual({ status: 'fulfilled', value: 20 });
    expect(results[2]?.status).toBe('rejected');
    if (results[2]?.status === 'rejected') {
      expect((results[2].reason as Error).message).toBe('fail-item-3');
    }
    expect(results[3]).toEqual({ status: 'fulfilled', value: 40 });
    expect(results[4]).toEqual({ status: 'fulfilled', value: 50 });
  });

  it('clamps invalid or small limit to at least 1', async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3];

    const results = await runWithConcurrency(items, 0, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return item;
    });

    expect(maxActive).toBe(1);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([1, 2, 3]);
  });
});
