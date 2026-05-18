/**
 * Observable Global Analysis Store (Zustand + Sentry)
 * Manages streaming analysis state with full production observability
 * Wraps all async operations in Sentry transactions for end-to-end tracing
 */

import { create } from 'zustand';
import * as Sentry from '@sentry/nextjs';
import type { AnalysisResult } from '@/lib/types';
import { parseSSELine } from '@/lib/streaming/decoder';

export interface AnalysisState {
  // Current analysis
  analysis: AnalysisResult | null;
  isLoading: boolean;
  status: 'idle' | 'downloading' | 'parsing' | 'analyzing' | 'complete' | 'error';
  error: string | null;

  // Rate limit tracking
  lockoutTimeRemaining: number;

  // History (persisted for session)
  analysisHistory: AnalysisResult[];

  // Actions
  setAnalysis: (analysis: AnalysisResult | null) => void;
  setIsLoading: (loading: boolean) => void;
  setStatus: (status: AnalysisState['status']) => void;
  setError: (error: string | null) => void;
  setLockoutTimeRemaining: (time: number) => void;
  clearAnalysis: () => void;
  addToHistory: (analysis: AnalysisResult) => void;
  clearHistory: () => void;

  // Observable async operations (wrapped in Sentry spans)
  startAnalysis: (url: string, timezone: string) => Promise<void>;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  // Initial state
  analysis: null,
  isLoading: false,
  status: 'idle',
  error: null,
  lockoutTimeRemaining: 0,
  analysisHistory: [],

  // Synchronous actions
  setAnalysis: (analysis) => set({ analysis }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setLockoutTimeRemaining: (time) => set({ lockoutTimeRemaining: time }),

  clearAnalysis: () =>
    set({
      analysis: null,
      isLoading: false,
      status: 'idle',
      error: null,
    }),

  addToHistory: (analysis) =>
    set((state) => {
      const updated = [analysis, ...state.analysisHistory].slice(0, 20);
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
          set({ isLoading: true, status: 'downloading', error: null });

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
            set({ error: errorMsg, status: 'error', isLoading: false });
            Sentry.captureException(new Error(errorMsg), {
              tags: { operation: 'startAnalysis', phase: 'http_response' },
              contexts: { response: { statusCode: response.status } },
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
              const decoder = new TextDecoder();
              let buffer = '';

              while (true) {
                try {
                  const { done, value } = await reader.read();
                  if (done) break;

                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || ''; // Retain incomplete line

                  for (const line of lines) {
                    try {
                      const token = parseSSELine(line);
                      if (token) markdown += token;
                    } catch (parseError) {
                      Sentry.captureException(parseError, {
                        tags: { operation: 'startAnalysis', phase: 'stream_chunk_parse' },
                        level: 'warning',
                      });
                    }
                  }
                } catch (readError) {
                  Sentry.captureException(readError, {
                    tags: { operation: 'startAnalysis', phase: 'stream_read' },
                  });
                  set({ error: 'Stream reading error', status: 'error', isLoading: false });
                  throw readError;
                }
              }
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

          set({
            analysis: {
              id: url,
              markdown,
              title: 'Analysis Result',
            },
            status: 'complete',
            isLoading: false,
          });

          // Add to history
          const state = get();
          if (state.analysis) {
            state.addToHistory(state.analysis);
          }

          Sentry.captureMessage('Analysis completed successfully', 'info');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          set({ error: errorMsg, status: 'error', isLoading: false });

          Sentry.captureException(error, {
            tags: { operation: 'startAnalysis', phase: 'unhandled' },
            contexts: {
              store: {
                currentStatus: get().status,
                hasAnalysis: !!get().analysis,
              },
            },
          });
        }
      }
    );
  },
}));
