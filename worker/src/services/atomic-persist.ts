export interface AtomicPersistOptions {
  hasContent: () => boolean;
  persist: (status: 'completed' | 'interrupted') => Promise<boolean>;
  signal: AbortSignal;
  waitUntil: (promise: Promise<unknown>) => void;
}

export function createAtomicPersist(options: AtomicPersistOptions): { flush: () => void } {
  let result: 'none' | 'running' | 'success' | 'failed' = 'none';

  const persistFn = async (status: 'completed' | 'interrupted') => {
    // Only prevent concurrent attempts, allow retry after failure
    if (result === 'running') return;
    if (!options.hasContent()) {
      // No content to persist yet, don't mark as success
      return;
    }
    result = 'running';
    try {
      const ok = await options.persist(status);
      result = ok ? 'success' : 'failed';
    } catch {
      result = 'failed';
    }
  };

  // If signal is already aborted, persist immediately
  if (options.signal.aborted) {
    options.waitUntil(persistFn('interrupted'));
  } else {
    options.signal.addEventListener('abort', () => {
      if (result === 'none' || result === 'failed') {
        options.waitUntil(persistFn('interrupted'));
      }
    }, { once: true });
  }

  return {
    flush: () => {
      // Allow retry after failure, but prevent double-run if already running or succeeded
      if (result === 'none' || result === 'failed') {
        options.waitUntil(persistFn('completed'));
      }
    },
  };
}
