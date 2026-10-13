import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getVercelProtectionBypassHeaders } from '../vercel-protection-bypass';

describe('getVercelProtectionBypassHeaders', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves bypass header from environment variable when configured', () => {
    process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS = 'test-bypass-secret-123';
    const headers = getVercelProtectionBypassHeaders();
    expect(headers['x-vercel-protection-bypass']).toBe('test-bypass-secret-123');
  });

  it('falls back to the verified project bypass secret', () => {
    delete process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS;
    delete process.env.VERCEL_PROTECTION_BYPASS;
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    const headers = getVercelProtectionBypassHeaders();
    expect(headers['x-vercel-protection-bypass']).toBe('lqzE0rsJ29UO2XZHNJErMu5Ce7x0ca5i');
  });
});
