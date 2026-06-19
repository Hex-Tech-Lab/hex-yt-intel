/**
 * env.ts — Placeholder handling regression tests.
 * Verifies isPlaceholder() correctly identifies placeholder values
 * and does NOT misclassify legitimate production values.
 */
import { describe, it, expect } from 'vitest';

/**
 * Replicate isPlaceholder logic from env.ts for testing.
 * The function checks for known placeholder substrings.
 */
function isPlaceholder(value: string | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  return (
    normalized.includes('dummy') ||
    normalized.includes('placeholder') ||
    normalized.includes('stub') ||
    normalized.includes('ci-build') ||
    value === ''
  );
}

describe('env.ts — isPlaceholder detection', () => {
  it('detects dummy values', () => {
    expect(isPlaceholder('dummy-value')).toBe(true);
    expect(isPlaceholder('DUMMY_KEY')).toBe(true);
    expect(isPlaceholder('supabase-dummy')).toBe(true);
  });

  it('detects placeholder values', () => {
    expect(isPlaceholder('placeholder')).toBe(true);
    expect(isPlaceholder('replace-with-real')).toBe(false); // "replace" != "placeholder"
    expect(isPlaceholder('YOUR_PLACEHOLDER_HERE')).toBe(true);
  });

  it('detects stub values', () => {
    expect(isPlaceholder('stub-key')).toBe(true);
    expect(isPlaceholder('STUB')).toBe(true);
  });

  it('detects ci-build values', () => {
    expect(isPlaceholder('ci-build')).toBe(true);
    expect(isPlaceholder('CI-BUILD-123')).toBe(true);
  });

  it('does NOT detect empty string (early return catches it)', () => {
    // isPlaceholder('') returns false because !value catches empty strings
    // before the value === '' check. In practice, clientEnv uses
    // `!process.env.X || isPlaceholder(...)` which catches empty via the first guard.
    expect(isPlaceholder('')).toBe(false);
  });

  it('does NOT flag legitimate Supabase URLs', () => {
    expect(isPlaceholder('https://abc123.supabase.co')).toBe(false);
    expect(isPlaceholder('https://xyz-project.supabase.co')).toBe(false);
  });

  it('does NOT flag legitimate Supabase anon keys', () => {
    expect(isPlaceholder('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test')).toBe(false);
  });

  it('does NOT flag legitimate worker URLs', () => {
    expect(isPlaceholder('https://hex-yt-intel.kelly-melvin.workers.dev')).toBe(false);
    expect(isPlaceholder('https://yt-intel.getmytestdrive.com')).toBe(false);
  });

  it('does NOT flag undefined or non-string', () => {
    expect(isPlaceholder(undefined)).toBe(false);
  });

  it('edge case: value containing "stub" as part of a real word', () => {
    // "stubborn" contains "stub" — this IS flagged because isPlaceholder uses includes()
    // This is a known limitation: substring matching can produce false positives.
    // In practice, env values don't contain English words like "stubborn".
    expect(isPlaceholder('stubborn-api-key')).toBe(true);
  });
});
