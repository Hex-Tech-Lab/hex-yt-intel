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
      getItem: (key: string) => existing.get(key) ?? null,
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
    // Mock whose FIRST setItem (the write probe) and SECOND setItem (the
    // durable_key write) succeed, then every later write throws
    // QuotaExceededError — proving the durable path works BEFORE the
    // mid-session quota failure flips the fallback (Wave 10.6 correction:
    // writes > 1 latched on the probe alone and never proved a real write
    // reached backing storage first).
    let writes = 0;
    const disk = new Map<string, string>();
    const mockStorage = {
      length: 0,
      getItem: (key: string) => disk.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes += 1;
        if (writes > 2) throw new DOMException('quota full', 'QuotaExceededError');
        disk.set(key, value);
      },
      removeItem: (key: string) => {
        disk.delete(key);
      },
      clear: () => disk.clear(),
      key: (i: number) => Array.from(disk.keys())[i] ?? null,
    } as unknown as Storage;

    const storage = createSafeStorage(() => mockStorage);

    // Probe succeeded (write #1): not memory-only yet.
    expect(storage.isMemoryFallbackActive()).toBe(false);
    storage.setItem('durable_key', 'on_disk');
    // The durable write (write #2) must REACH THE BACKING MAP, not just the
    // overlay — this is the pre-failure durability this test now proves.
    expect(disk.get('durable_key')).toBe('on_disk');
    expect(storage.getItem('durable_key')).toBe('on_disk');

    // Quota hits (write #3): the write must still SUCCEED from the caller's
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

  it('clear() masks backing keys the backing itself could not clear', () => {
    const disk = new Map<string, string>([['stale_key', 'old_value']]);
    const mockStorage = {
      get length() {
        return disk.size;
      },
      getItem: (key: string) => disk.get(key) ?? null,
      setItem: (key: string, value: string) => {
        disk.set(key, value);
      },
      removeItem: (key: string) => {
        disk.delete(key);
      },
      clear: () => {
        throw new DOMException('clear blocked', 'SecurityError');
      },
      key: (index: number) => Array.from(disk.keys())[index] ?? null,
    } as unknown as Storage;

    const storage = createSafeStorage(() => mockStorage);
    // Probe + a real write reach disk fine.
    storage.setItem('fresh_key', 'fresh_value');
    expect(storage.getItem('fresh_key')).toBe('fresh_value');
    expect(storage.getItem('stale_key')).toBe('old_value');

    // clear() cannot clear the backing, but must be observably complete:
    // every backing key becomes masked for readers.
    storage.clear();
    expect(storage.getItem('stale_key')).toBeNull();
    expect(storage.getItem('fresh_key')).toBeNull();
    expect(storage.length).toBe(0);
    // A failed backing clear is a non-durable mutation: it must latch
    // memory-only honestly (Wave 10.6 zombie-deletion contract).
    expect(storage.isMemoryFallbackActive()).toBe(true);
    // Writes still succeed via the overlay after the failed backing clear.
    expect(() => storage.setItem('after_clear', 'mem_only')).not.toThrow();
    expect(storage.getItem('after_clear')).toBe('mem_only');
  });

  it('latches memory-fallback when a backing deletion fails (zombie-deletion contract)', () => {
    const disk = new Map<string, string>([['zombie_key', 'undead']]);
    // The FIRST removeItem is the write PROBE (probe = setItem + removeItem)
    // and must succeed; every later deletion throws — the mid-session
    // deletion-failure shape.
    let removes = 0;
    const mockStorage = {
      get length() {
        return disk.size;
      },
      getItem: (key: string) => disk.get(key) ?? null,
      setItem: (key: string, value: string) => {
        disk.set(key, value);
      },
      removeItem: (key: string) => {
        removes += 1;
        if (removes > 1) throw new DOMException('remove blocked', 'SecurityError');
        disk.delete(key);
      },
      clear: () => disk.clear(),
      key: (index: number) => Array.from(disk.keys())[index] ?? null,
    } as unknown as Storage;

    const storage = createSafeStorage(() => mockStorage);
    // Probe succeeded: writes were healthy.
    expect(storage.isMemoryFallbackActive()).toBe(false);

    // Deletion fails on the backing: the item must be gone AS OBSERVED
    // (masked), and the facade must latch memory-only — otherwise a failed
    // deletion silently reappears after reload ("zombie deletion").
    storage.removeItem('zombie_key');
    expect(storage.getItem('zombie_key')).toBeNull();
    expect(storage.isMemoryFallbackActive()).toBe(true);

    // The latch is one-way: later writes serve the overlay and keep
    // reporting memory-only (backing writes are no longer attempted).
    storage.setItem('after_latch', 'mem_only');
    expect(storage.getItem('after_latch')).toBe('mem_only');
    expect(storage.isMemoryFallbackActive()).toBe(true);
  });

  it('enumerates an empty-string key ("" is a valid storage key)', () => {
    const disk = new Map<string, string>([
      ['', 'empty_key_value'],
      ['normal_key', 'normal_value'],
    ]);
    const mockStorage = {
      get length() {
        return disk.size;
      },
      getItem: (key: string) => disk.get(key) ?? null,
      setItem: (key: string, value: string) => {
        disk.set(key, value);
      },
      removeItem: (key: string) => {
        disk.delete(key);
      },
      clear: () => disk.clear(),
      key: (index: number) => Array.from(disk.keys())[index] ?? null,
    } as unknown as Storage;

    const storage = createSafeStorage(() => mockStorage);
    // The truthiness check (`if (k)`) stripped "" from enumeration — only
    // null means "no key here".
    expect(storage.length).toBe(2);
    expect(storage.key(0)).toBe('');
    expect(storage.getItem('')).toBe('empty_key_value');
    // Clear must also mask the empty-string key (observably complete).
    storage.clear();
    expect(storage.getItem('')).toBeNull();
  });
});

