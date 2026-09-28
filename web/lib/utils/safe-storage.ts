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
  /**
   * True when writes are NOT reaching durable disk storage (no backing
   * storage, access probe failed, or a write error latched write mode off).
   * Data written in this mode lives only in the per-session in-memory
   * overlay and is lost on page reload — callers that promise durability
   * (e.g. the chat outbox) must surface that honestly.
   */
  isMemoryFallbackActive(): boolean;
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
    isMemoryFallbackActive: () => true,
  };
}

export function createSafeStorage(getGlobal: () => Storage | null): SafeStorageLike {
  let underlying: Storage | null = null;
  let canRead = false;
  let canWrite = false;
  const overlay = new Map<string, string>();
  const deletedKeys = new Set<string>();

  try {
    const global = getGlobal();
    if (global) {
      underlying = global;
      // Probe read first — if SecurityError throws, reading is disabled
      underlying.getItem('__hx_probe__');
      canRead = true;

      // Probe write
      const probeKey = '__hx_safe_storage_probe__';
      underlying.setItem(probeKey, '1');
      underlying.removeItem(probeKey);
      canWrite = true;
    }
  } catch (probeError) {
    console.warn('[safe-storage] Storage access probe encountered limitation:', probeError);
  }

  return {
    get length() {
      if (!underlying || !canRead) {
        return overlay.size;
      }
      try {
        const keys = new Set<string>();
        for (let i = 0; i < underlying.length; i++) {
          const k = underlying.key(i);
          if (k && !deletedKeys.has(k)) keys.add(k);
        }
        for (const k of overlay.keys()) {
          keys.add(k);
        }
        return keys.size;
      } catch {
        return overlay.size;
      }
    },
    clear: () => {
      overlay.clear();
      deletedKeys.clear();
      if (underlying && canWrite) {
        try {
          underlying.clear();
        } catch (clearError) {
          console.warn('[safe-storage] underlying.clear failed:', clearError);
        }
      }
    },
    getItem: (key) => {
      if (deletedKeys.has(key)) return null;
      if (overlay.has(key)) return overlay.get(key) ?? null;
      if (underlying && canRead) {
        try {
          return underlying.getItem(key);
        } catch (getItemError) {
          console.warn('[safe-storage] underlying.getItem failed:', getItemError);
          return null;
        }
      }
      return null;
    },
    key: (index) => {
      try {
        const keys: string[] = [];
        if (underlying && canRead) {
          for (let i = 0; i < underlying.length; i++) {
            const k = underlying.key(i);
            if (k && !deletedKeys.has(k) && !overlay.has(k)) keys.push(k);
          }
        }
        for (const k of overlay.keys()) {
          keys.push(k);
        }
        return index >= 0 && index < keys.length ? keys[index]! : null;
      } catch {
        const keys = Array.from(overlay.keys());
        return index >= 0 && index < keys.length ? keys[index]! : null;
      }
    },
    removeItem: (key) => {
      overlay.delete(key);
      deletedKeys.add(key);
      if (underlying && canWrite) {
        try {
          underlying.removeItem(key);
        } catch (removeError) {
          console.warn('[safe-storage] underlying.removeItem failed:', removeError);
        }
      }
    },
    setItem: (key, value) => {
      overlay.set(key, value);
      deletedKeys.delete(key);
      if (underlying && canWrite) {
        try {
          underlying.setItem(key, value);
        } catch (err) {
          canWrite = false; // Degrade writes to in-memory overlay only
          console.warn('[safe-storage] underlying.setItem failed; degraded to in-memory write overlay:', err);
        }
      }
    },
    isMemoryFallbackActive: () => !underlying || !canWrite,
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
