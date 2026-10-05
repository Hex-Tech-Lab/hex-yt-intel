import { describe, it, expect, vi, afterEach } from 'vitest';

describe('GET /api/health — vector subsystem honesty (10X scan T4 sink correction)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports vector: healthy only when both UPSTASH_VECTOR creds are set', async () => {
    vi.stubEnv('UPSTASH_VECTOR_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_VECTOR_REST_TOKEN', 'tok');
    const { GET } = await import('../../app/api/health/route');
    const body = await (await GET()).json();
    expect(body.subsystems.vector).toBe('healthy');
  });

  it('reports vector: unconfigured when creds are absent (no phantom healthy)', async () => {
    vi.stubEnv('UPSTASH_VECTOR_REST_URL', '');
    vi.stubEnv('UPSTASH_VECTOR_REST_TOKEN', '');
    const { GET } = await import('../../app/api/health/route');
    const body = await (await GET()).json();
    expect(body.subsystems.vector).toBe('unconfigured');
  });

  it('never echoes credential values in the health payload', async () => {
    vi.stubEnv('UPSTASH_VECTOR_REST_URL', 'https://secret-url-value.upstash.io');
    vi.stubEnv('UPSTASH_VECTOR_REST_TOKEN', 'super-secret-token-value');
    const { GET } = await import('../../app/api/health/route');
    const text = JSON.stringify(await (await GET()).json());
    expect(text).not.toContain('secret-url-value');
    expect(text).not.toContain('super-secret-token-value');
  });
});
