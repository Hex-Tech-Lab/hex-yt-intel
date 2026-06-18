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

  options.signal.addEventListener('abort', () => {
    // Check if already aborted before registering
    if (options.signal.aborted) return;
    if (result === 'none') {
      options.waitUntil(persistFn('interrupted'));
    }
  }, { once: true });

  return {
    flush: () => {
      if (result === 'none') {
        options.waitUntil(persistFn('completed'));
      }
    },
  };
}
