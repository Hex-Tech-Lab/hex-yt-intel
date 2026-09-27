import { describe, it, expect, beforeEach } from 'vitest';
import { safeLocalStorage, safeSessionStorage, safeStateLocalStorage } from '../safe-storage';

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
});
