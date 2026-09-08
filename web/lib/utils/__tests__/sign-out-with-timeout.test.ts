import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signOutWithTimeout } from '@/lib/utils/sign-out-with-timeout';
import type { SupabaseClient } from '@supabase/supabase-js';

function fakeSupabase(signOut: () => Promise<{ error: { message: string } | null }>): SupabaseClient {
  return { auth: { signOut } } as unknown as SupabaseClient;
}

describe('signOutWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns "success" when signOut resolves cleanly', async () => {
    const supabase = fakeSupabase(() => Promise.resolve({ error: null }));
    const outcome = await signOutWithTimeout(supabase, '[test]');
    expect(outcome).toBe('success');
  });

  it('returns "error" (not "success") when signOut RESOLVES with an error -- the real bug this fixes', async () => {
    // Supabase's signOut() resolves with { error } on failure, it does not
    // reject -- treating any non-throwing outcome as success silently
    // hides a genuinely failed sign-out from the user.
    const supabase = fakeSupabase(() => Promise.resolve({ error: { message: 'session already revoked' } }));
    const outcome = await signOutWithTimeout(supabase, '[test]');
    expect(outcome).toBe('error');
  });

  it('returns "rejected" when signOut throws/rejects', async () => {
    const supabase = fakeSupabase(() => Promise.reject(new Error('network failure')));
    const outcome = await signOutWithTimeout(supabase, '[test]');
    expect(outcome).toBe('rejected');
  });

  it('returns "timeout" when signOut never resolves', async () => {
    const supabase = fakeSupabase(() => new Promise(() => {}));
    const outcomePromise = signOutWithTimeout(supabase, '[test]');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await outcomePromise).toBe('timeout');
  });

  it('resolves in well under the timeout when signOut succeeds quickly', async () => {
    const supabase = fakeSupabase(() => Promise.resolve({ error: null }));
    const outcomePromise = signOutWithTimeout(supabase, '[test]');
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcomePromise).toBe('success');
  });
});
