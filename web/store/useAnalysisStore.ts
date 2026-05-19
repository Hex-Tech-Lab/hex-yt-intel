/**
 * Observable Global Analysis Store (Zustand + Sentry)
 * Manages streaming analysis state with full production observability
 * Wraps all async operations in Sentry transactions for end-to-end tracing
 */

import { create } from 'zustand';
import * as Sentry from '@sentry/nextjs';
import type { AnalysisResult } from '@/lib/types';
import { consumeSSEStream } from '@/lib/streaming/decoder';

export interface AnalysisState {
  // Current analysis
  analysis: AnalysisResult | null;
  analysisId: string | null;
  isLoading: boolean;
  status: 'idle' | 'downloading' | 'parsing' | 'analyzing' | 'complete' | 'error';
  error: string | null;

  // Rate limit tracking
  lockoutTimeRemaining: number;
  isLockedOut: boolean;
  lockedUntil: number | null;

  // History (persisted for session)
  analysisHistory: AnalysisResult[];

  // Actions
  setAnalysis: (analysis: AnalysisResult | null) => void;
  setAnalysisId: (id: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setStatus: (status: AnalysisState['status']) => void;
  setError: (error: string | null) => void;
  setLockoutTimeRemaining: (time: number) => void;
  setLockedOut: (locked: boolean, until: number | null) => void;
  clearAnalysis: () => void;
  addToHistory: (analysis: AnalysisResult) => void;
  clearHistory: () => void;

  // Observable async operations (wrapped in Sentry spans)
  startAnalysis: (url: string, timezone: string) => Promise<void>;
}

function sanitizeErrorContext(error: unknown, context?: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  if (error instanceof Error) {
    sanitized.message = error.message;
    if (error.stack) {
      const stackLines = error.stack.split('\n').slice(0, 3);
      sanitized.stack = stackLines.join('\n');
    }
  }

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string') {
        if (value.includes('youtube.com') || value.includes('youtu.be')) {
          sanitized[key] = 'https://youtube.com/watch?v=***';
        } else if (value.includes('@')) {
          sanitized[key] = 'user@***';
        } else {
          sanitized[key] = value;
        }
      } else {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  // Initial state
  analysis: null,
  analysisId: null,
  isLoading: false,
  status: 'idle',
  error: null,
  lockoutTimeRemaining: 0,
  isLockedOut: false,
  lockedUntil: null,
  analysisHistory: [],

  // Synchronous actions
  setAnalysis: (analysis) => set({ analysis }),
  setAnalysisId: (id) => set({ analysisId: id }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setLockoutTimeRemaining: (time) => set({ lockoutTimeRemaining: time }),
  setLockedOut: (locked, until) => set({ isLockedOut: locked, lockedUntil: until }),

  clearAnalysis: () =>
    set({
      analysis: null,
      analysisId: null,
      isLoading: false,
      status: 'idle',
      error: null,
    }),

  addToHistory: (analysis) =>
    set((state) => {
      const existing = state.analysisHistory.find((a) => a.id === analysis.id);
      let updated: AnalysisResult[];

      if (existing) {
        updated = state.analysisHistory.map((a) =>
          a.id === analysis.id ? { ...a, ...analysis } : a
        );
      } else {
        updated = [analysis, ...state.analysisHistory].slice(0, 20);
      }

      return { analysisHistory: updated };
    }),

  clearHistory: () => set({ analysisHistory: [] }),

  // Observable async operation with Sentry instrumentation
  startAnalysis: async (url: string, timezone: string) => {
    return Sentry.startSpan(
      {
        name: 'stream_analysis',
        op: 'http.client',
        attributes: {
          url,
          timezone,
        },
      },
      async () => {
        try {
          set({ isLoading: true, status: 'downloading', error: null, isLockedOut: false });

          const response = await Sentry.startSpan(
            { name: 'POST /api/analyses', op: 'http.client' },
            async () => {
              return fetch('/api/analyses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, timezone }),
              });
            }
          );

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error || `HTTP ${response.status}`;

            if (response.status === 429) {
              const retryAfterHeader = response.headers.get('Retry-After');
              const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
              const lockedUntil = Date.now() + retryAfterSeconds * 1000;

              set({ error: errorMsg, status: 'error', isLoading: false, isLockedOut: true, lockedUntil });
              Sentry.captureMessage('Rate limited: too many requests', 'warning');
              return;
            }

            set({ error: errorMsg, status: 'error', isLoading: false });
            const sanitized = sanitizeErrorContext(new Error(errorMsg), { statusCode: response.status });
            Sentry.captureException(new Error(errorMsg), {
              tags: { operation: 'startAnalysis', phase: 'http_response' },
              contexts: { response: sanitized },
            });
            return;
          }

          set({ status: 'parsing' });

          const reader = response.body?.getReader();
          if (!reader) {
            const error = new Error('Response body not readable');
            set({ error: error.message, status: 'error', isLoading: false });
            Sentry.captureException(error, {
              tags: { operation: 'startAnalysis', phase: 'stream_setup' },
            });
            return;
          }

          let markdown = '';
          set({ status: 'analyzing' });

          await Sentry.startSpan(
            { name: 'consume SSE stream', op: 'stream.parse' },
            async () => {
              await consumeSSEStream(
                reader,
                (token) => {
                  markdown += token;
                },
                (error, phase) => {
                  Sentry.captureException(error, {
                    tags: { operation: 'startAnalysis', phase: `stream_${phase}` },
                    level: phase === 'parse' ? 'warning' : 'error',
                  });

                  if (phase === 'read') {
                    set({ error: 'Stream reading error', status: 'error', isLoading: false });
                    throw error;
                  }
                }
              );
            }
          );

          if (!markdown) {
            const error = new Error('Empty response from API');
            set({ error: error.message, status: 'error', isLoading: false });
            Sentry.captureException(error, {
              tags: { operation: 'startAnalysis', phase: 'empty_response' },
            });
            return;
          }

          const currentAnalysisId = get().analysisId;
          set({
            analysis: {
              id: currentAnalysisId || url,
              markdown,
              title: 'Analysis Result',
            },
            status: 'complete',
            isLoading: false,
          });

          // Add to history (deduplication by analysisId)
          const state = get();
          if (state.analysis) {
            state.addToHistory(state.analysis);
          }

          Sentry.captureMessage('Analysis completed successfully', 'info');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          set({ error: errorMsg, status: 'error', isLoading: false });

          const sanitized = sanitizeErrorContext(error, {
            currentStatus: get().status,
            hasAnalysis: !!get().analysis,
          });
          Sentry.captureException(error, {
            tags: { operation: 'startAnalysis', phase: 'unhandled' },
            contexts: { store: sanitized },
          });
        }
      }
    );
  },
}));
