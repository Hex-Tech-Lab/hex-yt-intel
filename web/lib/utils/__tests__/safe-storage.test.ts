import { describe, it, expect, beforeEach } from 'vitest';
import { safeLocalStorage, safeSessionStorage, safeStateLocalStorage, createSafeStorage } from '../safe-storage';

describe('safe-storage', () => {
  beforeEach(() => {
    safeLocalStorage.clear();
  });

  it('stores and retrieves items in safeLocalStorage', () => {
    safeLocalStorage.setItem('test_key', 'test_value');
    expect(safeLocalStorage.getItem('test_key')).toBe('test_value');
    expect(safeLocalStorage.length).toBe(1);

    safeLocalStorage.removeItem('test_key');
    expect(safeLocalStorage.getItem('test_key')).toBeNull();
    expect(safeLocalStorage.length).toBe(0);
  });

  it('provides safeStateLocalStorage interface for Zustand persist', () => {
    safeStateLocalStorage.setItem('state_key', '{"state":{"url":"https://youtu.be/abc"}}');
    expect(safeStateLocalStorage.getItem('state_key')).toBe('{"state":{"url":"https://youtu.be/abc"}}');

    safeStateLocalStorage.removeItem('state_key');
    expect(safeStateLocalStorage.getItem('state_key')).toBeNull();
  });

  it('handles safeSessionStorage operations without error', () => {
    safeSessionStorage.setItem('session_key', 'session_val');
    expect(safeSessionStorage.getItem('session_key')).toBe('session_val');
    safeSessionStorage.clear();
    expect(safeSessionStorage.getItem('session_key')).toBeNull();
  });

  it('preserves reads from underlying storage when write probe fails or throws', () => {
    const existing = new Map<string, string>([['existing_key', 'saved_data']]);
    const mockStorage = {
      length: 1,
      getItem: (k: string) => existing.get(k) ?? null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
      clear: () => {},
      key: () => 'existing_key',
    } as unknown as Storage;

    const storage = createSafeStorage(() => mockStorage);
    // Can read pre-existing data from underlying storage
    expect(storage.getItem('existing_key')).toBe('saved_data');

    // Writing fails on underlying storage but is preserved in memory overlay
    storage.setItem('new_key', 'new_value');
    expect(storage.getItem('new_key')).toBe('new_value');

    // Can still read pre-existing data
    expect(storage.getItem('existing_key')).toBe('saved_data');
  });

  it('succeeds via the in-memory overlay when quota is exceeded mid-session, and reports isMemoryFallbackActive', () => {
    // Mock whose FIRST setItem (the write probe) succeeds but every later
    // write throws QuotaExceededError — the mid-session quota-full shape.
    let writes = 0;
    const disk = new Map<string, string>();
    const mockStorage = {
      length: 0,
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => {
        writes += 1;
        if (writes > 1) throw new DOMException('quota full', 'QuotaExceededError');
        disk.set(k, v);
      },
      removeItem: (k: string) => {
        disk.delete(k);
      },
      clear: () => disk.clear(),
      key: (i: number) => Array.from(disk.keys())[i] ?? null,
    } as unknown as Storage;

    const storage = createSafeStorage(() => mockStorage);

    // Probe succeeded and the first write reached disk: not memory-only yet.
    expect(storage.isMemoryFallbackActive()).toBe(false);
    storage.setItem('durable_key', 'on_disk');
    expect(storage.getItem('durable_key')).toBe('on_disk');

    // Quota hits: the write must still SUCCEED from the caller's
    // perspective (Wave 7 contract — no throw), served by the overlay.
    expect(() => storage.setItem('overflow_key', 'in_memory')).not.toThrow();
    expect(storage.getItem('overflow_key')).toBe('in_memory');
    // The facade now reports memory-only writes honestly.
    expect(storage.isMemoryFallbackActive()).toBe(true);
    // Earlier durable data is still readable from disk.
    expect(storage.getItem('durable_key')).toBe('on_disk');

    // The latch is one-way: clearing does not re-enable writes.
    storage.clear();
    expect(storage.isMemoryFallbackActive()).toBe(true);
  });

  it('isMemoryFallbackActive is true for a pure in-memory store', () => {
    const storage = createSafeStorage(() => null);
    storage.setItem('k', 'v');
    expect(storage.isMemoryFallbackActive()).toBe(true);
    expect(storage.getItem('k')).toBe('v');
  });
});

