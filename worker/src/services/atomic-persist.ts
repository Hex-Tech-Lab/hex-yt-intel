export interface AtomicPersistOptions {
  hasContent: () => boolean;
  persist: (status: 'completed' | 'interrupted') => Promise<boolean>;
  signal: AbortSignal;
  waitUntil: (promise: Promise<unknown>) => void;
}

export function createAtomicPersist(options: AtomicPersistOptions): { flush: () => void } {
  let settled = false;
  let persisting = false;

  const persistFn = async (status: 'completed' | 'interrupted') => {
    if (settled || persisting) return;
    if (!options.hasContent()) return;
    persisting = true;
    try {
      settled = await options.persist(status);
    } finally {
      persisting = false;
    }
  };

  options.signal.addEventListener('abort', () => {
    if (!settled && !persisting) {
      options.waitUntil(persistFn('interrupted'));
    }
  });

  return {
    flush: () => {
      if (!settled) {
        options.waitUntil(persistFn('completed'));
      }
    },
  };
}
