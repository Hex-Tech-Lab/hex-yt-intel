/**
 * Observable Global Analysis Store (Zustand + Sentry)
 * Manages streaming analysis state with full production observability
 * Wraps all async operations in Sentry transactions for end-to-end tracing
 */

import { create } from 'zustand';
import * as Sentry from '@sentry/nextjs';
import type { AnalysisResult, UseAnalysisStreamState, AnalysisStatus } from '@/lib/types';
import { parseSSELine } from '@/lib/streaming/decoder';

export interface AnalysisState extends UseAnalysisStreamState {
  analysisHistory: AnalysisResult[];
  setAnalysis: (analysis: AnalysisResult | null) => void;
  setIsLoading: (loading: boolean) => void;
  setStatus: (status: AnalysisStatus) => void;
  setError: (error: string | null) => void;
  setLockoutTimeRemaining: (time: number) => void;
  clearAnalysis: () => void;
  addToHistory: (analysis: AnalysisResult) => void;
  clearHistory: () => void;
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
    // Extract videoId from URL for telemetry (redact raw URL to preserve PII compliance)
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch?.[1] || 'unknown';

    // Validate timezone against IANA naming conventions (alphanumeric + underscore/dash)
    const isValidTimezone = /^[a-zA-Z0-9_/-]+$/.test(timezone);
    const safeTimezone = isValidTimezone ? timezone : 'UTC';

    return Sentry.startSpan(
      {
        name: 'stream_analysis',
        op: 'http.client',
        attributes: {
          videoId, // Safe: extracted identifier only
          timezone: safeTimezone, // Safe: validated IANA format
          // Removed: raw 'url' field to prevent PII leakage via user-provided content
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

          // Check Content-Type to determine response format
          const contentType = response.headers.get('content-type') || '';
          const isSSEStream = contentType.includes('text/event-stream');

          let markdown = '';

          if (isSSEStream) {
            // Handle SSE streaming response (from OpenRouter)
            const reader = response.body?.getReader();
            if (!reader) {
              const error = new Error('Response body not readable');
              set({ error: error.message, status: 'error', isLoading: false });
              Sentry.captureException(error, {
                tags: { operation: 'startAnalysis', phase: 'stream_setup' },
              });
              return;
            }

            set({ status: 'analyzing' });

            await Sentry.startSpan(
              { name: 'consume SSE stream', op: 'stream.parse' },
              async () => {
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                  try {
                    const { done, value } = await reader.read();
                    if (done) {
                      // Process final incomplete line if buffer not empty
                      if (buffer.trim()) {
                        try {
                          const token = parseSSELine(buffer);
                          if (token) markdown += token;
                        } catch (parseError) {
                          Sentry.captureException(parseError, {
                            tags: { operation: 'startAnalysis', phase: 'stream_final_line' },
                            level: 'warning',
                          });
                        }
                      }
                      break;
                    }

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
          } else {
            // Handle JSON response (cache hit or error response)
            set({ status: 'analyzing' });
            try {
              const jsonData = await response.json();
              // Extract markdown from cached JSON response
              if (jsonData.markdown) {
                markdown = jsonData.markdown;
                Sentry.captureMessage('Analysis loaded from cache (JSON)', 'info');
              } else if (jsonData.error) {
                // This is an error response, not a valid analysis
                throw new Error(jsonData.error);
              } else {
                throw new Error('Invalid response format: no markdown or error field');
              }
            } catch (jsonError) {
              Sentry.captureException(jsonError, {
                tags: { operation: 'startAnalysis', phase: 'json_parse' },
              });
              set({ error: jsonError instanceof Error ? jsonError.message : 'Invalid response', status: 'error', isLoading: false });
              return;
            }
          }

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
