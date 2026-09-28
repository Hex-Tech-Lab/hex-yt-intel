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

/**
 * SafeStorageLike — a never-throwing storage facade over an optional
 * backing `Storage`.
 *
 * DATA-LOSS BOUNDARY (Wave 10.7, Cubic P1 — documented limitation):
 * once `isMemoryFallbackActive()` returns true, ALL subsequent mutations —
 * writes, removals, and clears — are strictly session-local: they apply
 * only to the per-session in-memory overlay / deletion mask and are never
 * reconciled back to the backing store. On page reload:
 *
 *   - failed WRITES are lost (the overlay never reached disk), and
 *   - failed DELETIONS reappear (the deletion mask is volatile; the
 *     backing store still holds the "zombie" value).
 *
 * This is a hard limitation of browser storage failures — if the disk is
 * broken, deletion cannot be guaranteed. Callers that promise durability
 * or deletion (e.g. the chat outbox) must surface this honestly while the
 * fallback is active; only a successful underlying mutation is durable.
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
          // "" is a valid storage key — only null means "no key here".
          if (k !== null && !deletedKeys.has(k)) keys.add(k);
        }
        for (const k of overlay.keys()) {
          keys.add(k);
        }
        return keys.size;
      } catch (lengthError) {
        console.warn('[safe-storage] underlying length enumeration failed; reporting overlay only:', lengthError);
        return overlay.size;
      }
    },
    clear: () => {
      overlay.clear();
      let backingCleared = false;
      if (underlying && canWrite) {
        try {
          underlying.clear();
          backingCleared = true;
        } catch (clearError) {
          canWrite = false; // Non-durable clear: latch writes off (zombie-deletion contract)
          console.warn('[safe-storage] underlying.clear failed:', clearError);
        }
      }
      if (backingCleared || !underlying || !canRead) {
        deletedKeys.clear();
        return;
      }
      // Underlying could not be cleared (write-degraded or clear threw) but
      // is still readable: mask its keys via deletedKeys so clear() is
      // observably complete — getItem/key/length must report empty for them.
      try {
        for (let i = 0; i < underlying.length; i++) {
          const k = underlying.key(i);
          // "" is a valid storage key — only null means "no key here".
          if (k !== null) deletedKeys.add(k);
        }
      } catch (enumError) {
        console.warn('[safe-storage] underlying key enumeration failed during clear:', enumError);
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
            // "" is a valid storage key — only null means "no key here".
            if (k !== null && !deletedKeys.has(k) && !overlay.has(k)) keys.push(k);
          }
        }
        for (const k of overlay.keys()) {
          keys.push(k);
        }
        return index >= 0 && index < keys.length ? keys[index]! : null;
      } catch (keyError) {
        console.warn('[safe-storage] underlying key enumeration failed; reporting overlay only:', keyError);
        const keys = Array.from(overlay.keys());
        return index >= 0 && index < keys.length ? keys[index]! : null;
      }
    },
    removeItem: (key) => {
      if (underlying && canWrite) {
        try {
          underlying.removeItem(key);
          overlay.delete(key);
          deletedKeys.delete(key);
          return;
        } catch (removeError) {
          canWrite = false; // Non-durable deletion: latch writes off (zombie-deletion contract)
          console.warn('[safe-storage] underlying.removeItem failed; writes degraded to in-memory overlay:', removeError);
          // Mask for readers regardless — the item must be gone as observed.
          overlay.delete(key);
          deletedKeys.add(key);
          return;
        }
      }
      overlay.delete(key);
      deletedKeys.add(key);
    },
    setItem: (key, value) => {
      if (underlying && canWrite) {
        try {
          underlying.setItem(key, value);
          // Backing store is authoritative on success: drop any stale
          // overlay copy / deletion mask so it cannot shadow fresh reads.
          overlay.delete(key);
          deletedKeys.delete(key);
          return;
        } catch (err) {
          // The latch is intentionally one-way for the session.
          // Re-enabling writes dynamically after a transient failure would
          // risk writing stale in-memory states over recovered disk
          // states. Full page reload is required to reset the storage
          // baseline.
          canWrite = false; // Degrade writes to in-memory overlay only
          console.warn('[safe-storage] underlying.setItem failed; degraded to in-memory write overlay:', err);
        }
      }
      overlay.set(key, value);
      deletedKeys.delete(key);
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
