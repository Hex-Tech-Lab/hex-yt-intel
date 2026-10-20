import { describe, it, expect } from 'vitest';
import health, { isConfigured } from '../routes/health';

describe('GET /health/providers', () => {
  it('reports a bound-but-empty secret as NOT configured (the 2026-09-26 TranscriptAPI incident)', async () => {
    const res = await health.request('/health/providers', {}, { TRANSCRIPTAPI_API_KEY: '', APIFY_TOKEN: 'tok', DECODO_API_KEY: '   ' });
    const body = (await res.json()) as Record<string, boolean>;
    expect(body).toMatchObject({ transcriptapi: false, apify: true, decodo: false, supadata: false });
  });

  it('never returns secret values, only booleans', async () => {
    const res = await health.request('/health/providers', {}, { TRANSCRIPTAPI_API_KEY: 'super-secret-value' });
    const text = await res.text();
    expect(text).not.toContain('super-secret-value');
    expect(Object.values(JSON.parse(text)).every((value) => typeof value === 'boolean')).toBe(true);
  });

  it('isConfigured: whitespace and undefined are not configured', () => {
    expect([isConfigured(undefined), isConfigured(''), isConfigured(' \n'), isConfigured('k')]).toEqual([false, false, false, true]);
  });
});
