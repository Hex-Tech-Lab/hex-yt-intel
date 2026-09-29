// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('useInputStore ?v= hydration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolveHydratedUrl replaces persisted video B with route video A', async () => {
    const mod = await import('@/store/useInputStore');
    const out = mod.resolveHydratedUrl(
      'https://www.youtube.com/watch?v=BBBBBBBBBBB',
      '?v=AAAAAAAAAAA',
    );
    expect(out).toBe('https://www.youtube.com/watch?v=AAAAAAAAAAA');
  });

  it('resolveHydratedUrl keeps the persisted URL when it already matches ?v=', async () => {
    const mod = await import('@/store/useInputStore');
    const url = 'https://www.youtube.com/watch?v=AAAAAAAAAAA';
    expect(mod.resolveHydratedUrl(url, '?v=AAAAAAAAAAA')).toBe(url);
  });

  it('resolveHydratedUrl keeps the persisted URL when no ?v= present', async () => {
    const mod = await import('@/store/useInputStore');
    const url = 'https://www.youtube.com/watch?v=BBBBBBBBBBB';
    expect(mod.resolveHydratedUrl(url, '')).toBe(url);
  });

  it('resolveHydratedUrl ignores a malformed ?v= value', async () => {
    const mod = await import('@/store/useInputStore');
    const url = 'https://www.youtube.com/watch?v=BBBBBBBBBBB';
    expect(mod.resolveHydratedUrl(url, '?v=not-a-valid-id-at-all')).toBe(url);
  });

  it('hydrated store url is the ?v= video A when persisted URL is video B', async () => {
    window.history.replaceState(null, '', `/?v=AAAAAAAAAAA`);
    const { safeStateLocalStorage } = await import('@/lib/utils/safe-storage');
    safeStateLocalStorage.setItem(
      'hex_intel_saved_input',
      JSON.stringify({
        state: { url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', isValid: false },
        version: 0,
      }),
    );
    const mod = await import('@/store/useInputStore');
    expect(mod.useInputStore.getState().url).toBe('https://www.youtube.com/watch?v=AAAAAAAAAAA');
  });
});
