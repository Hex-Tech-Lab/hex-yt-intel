/**
 * secretFingerprint underpins the token-rejection diagnostics: it lets the Worker
 * and the Vercel signer log a comparable, non-reversible fingerprint of their
 * STREAM_HMAC_SECRET so a secret mismatch (the cause of the analyze/chat 401s) is
 * instantly identifiable in logs — without ever logging the secret itself.
 */
import { describe, it, expect } from 'vitest';
import { secretFingerprint } from '../crypto';

describe('secretFingerprint', () => {
  it('is stable for the same secret (so two systems sharing it match)', async () => {
    expect(await secretFingerprint('shared-secret')).toBe(await secretFingerprint('shared-secret'));
  });

  it('differs for different secrets (so a mismatch is visible)', async () => {
    expect(await secretFingerprint('secret-a')).not.toBe(await secretFingerprint('secret-b'));
  });

  it('returns "unset" for a missing secret', async () => {
    expect(await secretFingerprint(undefined)).toBe('unset');
    expect(await secretFingerprint(null)).toBe('unset');
    expect(await secretFingerprint('')).toBe('unset');
  });

  it('does not reveal the secret and is short/stable-length', async () => {
    const fp = await secretFingerprint('super-secret-value-do-not-leak');
    expect(fp).not.toContain('super');
    expect(fp).not.toContain('secret');
    expect(fp).toHaveLength(10);
    expect(fp).toMatch(/^[0-9a-f]{10}$/);
  });
});
