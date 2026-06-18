export interface AtomicPersistOptions {
  hasContent: () => boolean;
  persist: (status: 'completed' | 'interrupted') => Promise<boolean>;
  signal: AbortSignal;
  waitUntil: (promise: Promise<unknown>) => void;
  maxRetries?: number;
}

export function createAtomicPersist(options: AtomicPersistOptions): { flush: () => void } {
  const maxRetries = options.maxRetries ?? 3;
  let result: 'none' | 'running' | 'success' | 'failed' = 'none';
  let attempts = 0;

  const persistFn = async (status: 'completed' | 'interrupted') => {
    // Only prevent concurrent attempts, allow retry after failure
    if (result === 'running') return;
    if (attempts >= maxRetries) return;
    if (!options.hasContent()) {
      // No content to persist yet, don't mark as success
      return;
    }
    attempts++;
    result = 'running';
    try {
      const ok = await options.persist(status);
      result = ok ? 'success' : (attempts >= maxRetries ? 'failed' : 'failed');
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
