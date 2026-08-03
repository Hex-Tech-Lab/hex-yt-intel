import { describe, it, expect } from 'vitest';
import { computeTimeWindow } from '@/lib/utils/time-range';

describe('computeTimeWindow', () => {
  it('defaults to a 1-hour window when no params are given', () => {
    const { startTimeMs, endTimeMs } = computeTimeWindow(new URLSearchParams());
    expect(endTimeMs - startTimeMs).toBe(3600000);
  });

  it('accepts custom range via startTime/endTime param names', () => {
    const start = '2026-08-01T00:00:00.000Z';
    const end = '2026-08-02T00:00:00.000Z';
    const { startTimeMs, endTimeMs } = computeTimeWindow(
      new URLSearchParams({ startTime: start, endTime: end })
    );
    expect(startTimeMs).toBe(new Date(start).getTime());
    expect(endTimeMs).toBe(new Date(end).getTime());
  });

  it('accepts custom range via start/end param names (LogsViewerClient live-fetch path)', () => {
    const start = '2026-08-01T00:00:00.000Z';
    const end = '2026-08-02T00:00:00.000Z';
    const { startTimeMs, endTimeMs } = computeTimeWindow(
      new URLSearchParams({ start, end })
    );
    expect(startTimeMs).toBe(new Date(start).getTime());
    expect(endTimeMs).toBe(new Date(end).getTime());
  });

  it('prefers startTime/endTime when both param-name pairs are present', () => {
    const preferred = '2026-08-01T00:00:00.000Z';
    const ignored = '2026-07-01T00:00:00.000Z';
    const { startTimeMs } = computeTimeWindow(
      new URLSearchParams({ startTime: preferred, start: ignored, end: preferred, endTime: preferred })
    );
    expect(startTimeMs).toBe(new Date(preferred).getTime());
  });

  it('falls back to the 1-hour default when custom params fail to parse', () => {
    const { startTimeMs, endTimeMs } = computeTimeWindow(
      new URLSearchParams({ start: 'not-a-date', end: 'also-not-a-date' })
    );
    expect(endTimeMs - startTimeMs).toBe(3600000);
  });
});
