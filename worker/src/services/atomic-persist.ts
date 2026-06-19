import * as Sentry from '@sentry/cloudflare';

export interface AtomicPersistOptions {
  hasContent: () => boolean;
  persist: (status: 'completed' | 'interrupted') => Promise<boolean>;
  signal: AbortSignal;
  waitUntil: (promise: Promise<unknown>) => void;
  maxRetries?: number;
}

export type AtomicPersistResult =
  | { type: 'idle' }
  | { type: 'running' }
  | { type: 'success' }
  | { type: 'failed'; error?: string };

export function createAtomicPersist(options: AtomicPersistOptions): {
  flush: () => void;
  result: () => AtomicPersistResult;
} {
  const maxRetries = options.maxRetries ?? 3;
  let state: AtomicPersistResult = { type: 'idle' };
  let attempts = 0;

  const persistFn = async (status: 'completed' | 'interrupted') => {
    if (state.type === 'running') return;
    if (attempts >= maxRetries) return;
    if (!options.hasContent()) return;

    state = { type: 'running' };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (options.signal.aborted && attempt > 0) {
        break;
      }

      attempts++;
      try {
        const ok = await options.persist(status);
        if (ok) {
          state = { type: 'success' };
          return;
        }
        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * 2 ** attempt, 8000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (error) {
        const isAbort =
          error instanceof DOMException && error.name === 'AbortError';
        if (isAbort) {
          state = { type: 'failed', error: 'aborted' };
          return;
        }
        Sentry.captureException(error, {
          contexts: { atomicPersist: { attempt, status, maxRetries } },
        });
        console.error('[atomic-persist]', {
          message: error instanceof Error ? error.message : String(error),
          attempt,
          status,
        });
        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * 2 ** attempt, 8000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    state = { type: 'failed', error: 'max_retries_exceeded' };
  };

  if (options.signal.aborted) {
    options.waitUntil(persistFn('interrupted'));
  } else {
    options.signal.addEventListener(
      'abort',
      () => {
        if (state.type === 'idle' || state.type === 'failed') {
          options.waitUntil(persistFn('interrupted'));
        }
      },
      { once: true },
    );
  }

  return {
    flush: () => {
      if (state.type === 'idle' || state.type === 'failed') {
        options.waitUntil(persistFn('completed'));
      }
    },
    result: () => state,
  };
}
