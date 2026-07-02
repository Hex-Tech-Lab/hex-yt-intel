/**
 * isProductionEnv is the single source of truth for "are we in production" in the
 * Worker. It gates the dev HMAC fallback, appUrl origin validation, and error
 * verbosity. The previous NODE_ENV-based checks were always-true on the deployed
 * worker (NODE_ENV is unset; only ENVIRONMENT is set), which opened an auth
 * bypass. These tests pin the corrected, fail-closed behaviour.
 */
import { describe, it, expect } from 'vitest';
import { isProductionEnv } from '../env-utils';

describe('isProductionEnv', () => {
  it('is true when ENVIRONMENT=production (the deployed worker case)', () => {
    expect(isProductionEnv({ ENVIRONMENT: 'production' })).toBe(true);
    // ENVIRONMENT wins even if NODE_ENV disagrees.
    expect(isProductionEnv({ ENVIRONMENT: 'production', NODE_ENV: 'development' })).toBe(true);
  });

  it('is false for local/preview when ENVIRONMENT is non-production', () => {
    expect(isProductionEnv({ ENVIRONMENT: 'preview' })).toBe(false);
    expect(isProductionEnv({ ENVIRONMENT: 'development' })).toBe(false);
  });

  it('falls back to NODE_ENV only when ENVIRONMENT is absent (local/test)', () => {
    expect(isProductionEnv({ NODE_ENV: 'development' })).toBe(false);
    expect(isProductionEnv({ NODE_ENV: 'production' })).toBe(true);
  });

  it('fails CLOSED (treats unknown as production) so dev fallbacks never leak', () => {
    // This is the exact prod-worker condition that used to be misread as non-prod.
    expect(isProductionEnv({})).toBe(true);
    expect(isProductionEnv(undefined)).toBe(true);
    expect(isProductionEnv(null)).toBe(true);
  });
});
