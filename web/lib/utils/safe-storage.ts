/**
 * Safe storage — Sentry HEX-YT-INTEL-5V.
 *
 * Android WebView (and some private-mode browsers) throw SecurityError on
 * `window.localStorage` access, and older/odd embedded webviews can expose
 * `localStorage` as null. Any bare `localStorage.getItem(...)` in those
 * environments throws and can take out store hydration / chat outbox reads.
 *
 * Strategy: try/catch around the FIRST actual access of
 * window.localStorage / window.sessionStorage; if it throws or the global is
 * null, fall back permanently to an in-memory Map<string, string> for the
 * remainder of the session (per-tab, matching the storage lifetime loss).
 */

export interface SafeStorageLike {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function createMemoryStorage(): SafeStorageLike {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => {
      const keys = Array.from(map.keys());
      return index >= 0 && index < keys.length ? keys[index]! : null;
    },
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function createSafeStorage(getGlobal: () => Storage | null): SafeStorageLike {
  let backing: SafeStorageLike | null = null;
  try {
    const global = getGlobal();
    if (!global) throw new Error('storage unavailable');
    // Probe with a real access — SecurityError throws here on Android WebView.
    const probeKey = '__hx_safe_storage_probe__';
    global.setItem(probeKey, '1');
    global.removeItem(probeKey);
    backing = global;
  } catch (probeError) {
    console.warn('[safe-storage] Storage access probe failed, using in-memory store:', probeError);
    backing = createMemoryStorage();
  }
  const resolved = backing;
  return {
    get length() {
      return resolved.length;
    },
    clear: () => {
      try {
        resolved.clear();
      } catch (clearError) {
        console.warn('[safe-storage] clear failed:', clearError);
      }
    },
    getItem: (key) => {
      try {
        return resolved.getItem(key);
      } catch (getItemError) {
        console.warn('[safe-storage] getItem failed:', getItemError);
        return null;
      }
    },
    key: (index) => {
      try {
        return resolved.key(index);
      } catch (keyError) {
        console.warn('[safe-storage] key failed:', keyError);
        return null;
      }
    },
    removeItem: (key) => {
      try {
        resolved.removeItem(key);
      } catch (removeError) {
        console.warn('[safe-storage] removeItem failed:', removeError);
      }
    },
    setItem: (key, value) => {
      try {
        resolved.setItem(key, value);
      } catch (err) {
        console.warn('[safe-storage] setItem failed (quota/private mode):', err);
      }
    },
  };
}

/** localStorage with in-memory fallback (never throws on access). */
export const safeLocalStorage: SafeStorageLike =
  typeof window === 'undefined'
    ? createMemoryStorage()
    : createSafeStorage(() => (typeof window.localStorage !== 'undefined' ? window.localStorage : null));

/** sessionStorage with in-memory fallback (never throws on access). */
export const safeSessionStorage: SafeStorageLike =
  typeof window === 'undefined'
    ? createMemoryStorage()
    : createSafeStorage(() => (typeof window.sessionStorage !== 'undefined' ? window.sessionStorage : null));

/**
 * Minimal StateStorage-compatible shape for Zustand's persist middleware
 * (createJSONStorage only needs getItem/setItem/removeItem).
 */
function createSafeStateStorage(getStorage: () => SafeStorageLike) {
  return {
    getItem: (name: string): string | null => getStorage().getItem(name),
    setItem: (name: string, value: string): void => getStorage().setItem(name, value),
    removeItem: (name: string): void => getStorage().removeItem(name),
  };
}

/** For `createJSONStorage(() => safeStateLocalStorage)` in Zustand persist. */
export const safeStateLocalStorage = createSafeStateStorage(() => safeLocalStorage);

/** For `createJSONStorage(() => safeStateSessionStorage)` in Zustand persist. */
export const safeStateSessionStorage = createSafeStateStorage(() => safeSessionStorage);
