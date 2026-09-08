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

  it('concurrency guard: two simultaneous calls (double-click, or two mounted sign-out buttons) only invoke the real signOut() once (race-condition-guard skill)', async () => {
    // Fires two "simultaneous" calls with a real barrier (both start before
    // either awaits) -- a sequential call wouldn't reproduce the race this
    // guards against.
    let signOutCallCount = 0;
    const supabase = fakeSupabase(() => {
      signOutCallCount += 1;
      return Promise.resolve({ error: null });
    });

    const [outcomeA, outcomeB] = await Promise.all([
      signOutWithTimeout(supabase, '[test-A]'),
      signOutWithTimeout(supabase, '[test-B]'),
    ]);

    expect(signOutCallCount).toBe(1);
    expect(outcomeA).toBe('success');
    expect(outcomeB).toBe('success');
  });

  it('concurrency guard releases after completion -- a THIRD call after the first settles starts a fresh signOut()', async () => {
    let signOutCallCount = 0;
    const supabase = fakeSupabase(() => {
      signOutCallCount += 1;
      return Promise.resolve({ error: null });
    });

    await signOutWithTimeout(supabase, '[test]');
    await signOutWithTimeout(supabase, '[test]');

    expect(signOutCallCount).toBe(2);
  });
});
