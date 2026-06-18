export interface AtomicPersistOptions {
  hasContent: () => boolean;
  persist: (status: 'completed' | 'interrupted') => Promise<boolean>;
  signal: AbortSignal;
  waitUntil: (promise: Promise<unknown>) => void;
}

export function createAtomicPersist(options: AtomicPersistOptions): { flush: () => void } {
  let result: 'none' | 'running' | 'success' | 'failed' = 'none';

  const persistFn = async (status: 'completed' | 'interrupted') => {
    if (result !== 'none') return;
    if (!options.hasContent()) { result = 'success'; return; }
    result = 'running';
    try {
      const ok = await options.persist(status);
      result = ok ? 'success' : 'failed';
    } catch {
      result = 'failed';
    }
  };

  options.signal.addEventListener('abort', () => {
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
