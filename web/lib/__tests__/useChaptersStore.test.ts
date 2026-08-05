import { describe, it, expect, beforeEach } from 'vitest';
import { useChaptersStore } from '@/store/useChaptersStore';

describe('useChaptersStore', () => {
  beforeEach(() => {
    useChaptersStore.setState({ entries: {}, generations: {} });
  });

  it('setLoaded writes chapters when generation matches (no reset occurred)', () => {
    const { setLoading, setLoaded } = useChaptersStore.getState();
    const generation = setLoading('vid1');
    setLoaded('vid1', [{ idx: 0, start_seconds: 0, end_seconds: 10, label: 'Intro' }], generation);

    const entry = useChaptersStore.getState().entries['vid1'];
    expect(entry.status).toBe('loaded');
    expect(entry.chapters).toHaveLength(1);
  });

  it('setLoaded is a no-op when reset() fired after the fetch started (stale generation)', () => {
    const { setLoading, setLoaded, reset } = useChaptersStore.getState();
    const generation = setLoading('vid1');

    // Re-analysis starts: reset() clears the cache and bumps the generation.
    reset('vid1');

    // The OLD fetch's response finally resolves and tries to write -- must be ignored.
    setLoaded('vid1', [{ idx: 0, start_seconds: 0, end_seconds: 10, label: 'Stale' }], generation);

    const entry = useChaptersStore.getState().entries['vid1'];
    expect(entry).toBeUndefined();
  });

  it('setError is a no-op when reset() fired after the fetch started (stale generation)', () => {
    const { setLoading, setError, reset } = useChaptersStore.getState();
    const generation = setLoading('vid1');

    reset('vid1');
    setError('vid1', generation);

    const entry = useChaptersStore.getState().entries['vid1'];
    expect(entry).toBeUndefined();
  });

  it('a fresh fetch started after reset() can still write successfully', () => {
    const { setLoading, setLoaded, reset } = useChaptersStore.getState();
    setLoading('vid1');
    reset('vid1');

    // New fetch cycle for the re-analyzed video, starting under the new generation.
    const newGeneration = setLoading('vid1');
    setLoaded('vid1', [{ idx: 0, start_seconds: 0, end_seconds: 5, label: 'Fresh' }], newGeneration);

    const entry = useChaptersStore.getState().entries['vid1'];
    expect(entry.status).toBe('loaded');
    expect(entry.chapters[0].label).toBe('Fresh');
  });

  it('getChapters returns a stable idle snapshot for a videoId with no entry', () => {
    const { getChapters } = useChaptersStore.getState();
    const a = getChapters('missing');
    const b = getChapters('missing');
    expect(a).toBe(b); // referentially stable across calls
    expect(a.status).toBe('idle');
  });
});
