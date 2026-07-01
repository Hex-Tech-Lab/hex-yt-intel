import { useRef, useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useChatStore } from '@/store/useChatStore';
import { SynthesisStreamAdapter } from '@/lib/adapters/synthesis-stream-adapter';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import type { WorkerStreamRequest } from '@/lib/types/contracts';
import { STREAM_BUNDLES, TOTAL_STREAMS, ABORT_ON_PARTIAL_FAILURE } from '@/lib/config/synthesis';

export function useSSEStream() {

  const {
    setIsLoading,
    setStatus,
    setError,
    initializeAnalysis,
    archiveCurrentAnalysis,
    setVideoMetadata,
    clearAnalysis,
  } = useAnalysisStore();

  const { initializeAnalysis: initSynthesis, reset: resetSynthesis } = useSynthesisNucleus();
  const abortControllerRef = useRef<AbortController | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const extractTelemetryId = (urlStr: string) => {
    try {
      const normalized = urlStr.trim().startsWith('http') ? urlStr.trim() : `https://${urlStr.trim()}`;
      const parsed = new URL(normalized);
      if (parsed.hostname?.includes('youtu.be')) return parsed.pathname.slice(1);
      if (parsed.pathname.includes('/shorts/')) return parsed.pathname.split('/')[2] || 'unknown';
      if (parsed.pathname.includes('/live/')) return parsed.pathname.split('/')[2] || 'unknown';
      if (parsed.pathname.includes('/embed/') || parsed.pathname.includes('/v/')) return parsed.pathname.split('/')[2] || 'unknown';
      return parsed.searchParams.get('v') || 'unknown';
    } catch (e) {
      console.debug('[useSSEStream] Failed to parse YouTube URL:', e);
      return 'unknown';
    }
  };

  const startAnalysis = async (url: string, timezone: string, forceRefresh: boolean = false) => {
    if (processingRef.current) return;
    processingRef.current = true;

    // 1. Abort any previous stream to prevent bifurcation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    const videoId = extractTelemetryId(url);
    // Merge with existing metadata (preserves eagerly-fetched data from useEagerVideoMetadata)
    const prev = useAnalysisStore.getState().videoMetadata;
    setVideoMetadata({
      videoId,
      title: prev?.videoId === videoId ? (prev.title || '') : '',
      channelTitle: prev?.videoId === videoId ? (prev.channelTitle || '') : '',
      channelId: prev?.videoId === videoId ? (prev.channelId || '') : '',
      publishedAt: prev?.videoId === videoId ? (prev.publishedAt || '') : '',
      duration: prev?.videoId === videoId ? prev.duration : null,
      viewCount: prev?.videoId === videoId ? (prev.viewCount || '') : '',
      likeCount: prev?.videoId === videoId ? (prev.likeCount || '') : '',
      commentCount: prev?.videoId === videoId ? (prev.commentCount || '') : '',
      thumbnailUrl: prev?.videoId === videoId ? prev.thumbnailUrl : null,
    });
    const safeTimezone = /^[a-zA-Z0-9_/-]+$/.test(timezone) ? timezone : 'UTC';

    const myController = new AbortController();
    abortControllerRef.current = myController;
    const currentSignal = myController.signal;

    // Set immediate status to update UI instantly without frame delays
    clearAnalysis();
    resetSynthesis();
    useChatStore.setState({ activeId: null });
    setIsLoading(true);
    setStatus('downloading');
    setError(null);

    // Offload secondary analytics tracking and stream configuration to a non-blocking execution frame
    setTimeout(async () => {
      try {
        await Sentry.startSpan(
          {
            name: 'analyze_edge_stream',
            op: 'http.client',
            attributes: { videoId, timezone: safeTimezone, forceRefresh },
          },
          async () => {
            try {
              const store = useAnalysisStore.getState();
              store.logInfo(`Initializing analysis pipeline for URL: ${url}`);

              // 1. Bouncer: auth + quota + ingestion. Returns 200 (cache) or 202 (job + token).
              const prepRes = await Sentry.startSpan(
                { name: 'POST /api/analyses', op: 'http.client' },
                async () => fetch('/api/analyses', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url, timezone, forceRefresh }),
                  signal: currentSignal,
                })
              );

              if (!prepRes.ok) {
                const errorData = await prepRes.json().catch(() => ({}));
                let errorMsg = errorData.message || errorData.error || `HTTP ${prepRes.status}`;
                let errorCode = errorData.code || 'ERR_REQUEST_FAILED';
                if (prepRes.status === 400 && errorData.details?.fieldErrors) {
                   const fieldErrors = errorData.details.fieldErrors;
                   errorCode = 'ERR_INVALID_REQUEST_SCHEMA';
                   errorMsg = fieldErrors.url
                     ? 'Invalid YouTube URL'
                     : Object.entries(fieldErrors)
                         .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors[0] : errors}`)
                         .join('; ') || 'Invalid request';
                }
                store.logError(`Bouncer checklist failed (${prepRes.status}): ${errorMsg}`);
                setError({ code: errorCode, status: prepRes.status, message: errorMsg });
                setStatus('error');
                setIsLoading(false);
                return;
              }

              const job = await prepRes.json();
              store.logOk(`Bouncer checklist complete. Auth & quota checks passed.`);

              // 2. Metadata extraction
              if (job.metadata) {
                setVideoMetadata(job.metadata);
              }

              // 3. Cache hit — render immediately.
              if (job.status === 'done' && job.markdown) {
                store.logOk(`Cache hit detected. Restoring historical synthesis instantly.`);
                initializeAnalysis(job.analysisId || job.id, job.title || 'Analysis Result', job.markdown);
                initSynthesis(job);
                setStatus('complete');
                setIsLoading(false);
                archiveCurrentAnalysis();
                return;
              }

              // 3. Stream directly from the Cloudflare Worker (no Vercel in the LLM path).
              if (!job.stream?.url) {
                const msg = 'Streaming endpoint not configured (NEXT_PUBLIC_WORKER_URL).';
                store.logError(`Configuration error: ${msg}`);
                setError({ code: 'ERR_STREAM_UNCONFIGURED', status: 0, message: msg });
                setStatus('error');
                setIsLoading(false);
                return;
              }

              store.logInfo(`Connecting to Cloudflare edge worker for unified intelligence synthesis...`);
              initializeAnalysis(job.analysisId || job.id, job.title || 'Analysis Result');
              initSynthesis(job);
              setStatus('analyzing');

              let hasSettled = false;

              const settleAnalysis = (finalStatus: 'complete' | 'error', errorMsg?: string) => {
                if (hasSettled) return;
                hasSettled = true;

                if (finalStatus === 'complete') {
                  store.logOk(`Analysis stream completed successfully.`);
                  useSynthesisNucleus.getState().completeAnalysis();
                  setStatus('complete');
                  setIsLoading(false);
                  archiveCurrentAnalysis();
                } else {
                  myController.abort();
                  const msg = errorMsg || 'Analysis stream failed to complete. Please try again.';
                  store.logError(msg);
                  setError({ code: 'ERR_STREAM_FATAL_FAILURE', status: 0, message: msg });
                  setStatus('error');
                  setIsLoading(false);
                }
              };

              const runSingleStream = async (i: number, dimensions: number[], adapter: SynthesisStreamAdapter, currentSignal: AbortSignal, job: any, safeTimezone: string) => {
                const streamPayload: WorkerStreamRequest = {
                  videoId: job.videoId,
                  analysisId: job.analysisId || job.id,
                  transcript: job.transcript || '',
                  metadata: job.metadata,
                  persona: job.persona,
                  timezone: job.timezone || safeTimezone,
                  models: job.models,
                  sig: job.stream.sig,
                  exp: job.stream.exp,
                  appUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
                  dimensions,
                  chunkIndex: i + 1,
                  totalChunks: TOTAL_STREAMS,
                };

                const streamController = new AbortController();
                const timeoutId = setTimeout(() => streamController.abort(), 25000);

                const controller = new AbortController();
                currentSignal.addEventListener('abort', () => controller.abort(), { once: true });
                streamController.signal.addEventListener('abort', () => controller.abort(), { once: true });
                const combinedSignal = controller.signal;

                let res;
                let timedOut = false;
                try {
                  res = await fetch(job.stream.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(streamPayload),
                    signal: combinedSignal,
                  });
                } catch (fetchErr: any) {
                  clearTimeout(timeoutId);
                  if (streamController.signal.aborted) timedOut = true;
                  if (fetchErr.name === 'AbortError') {
                    throw new Error(timedOut ? 'Handshake timed out after 25s.' : 'Request aborted.');
                  }
                  throw fetchErr;
                } finally {
                  clearTimeout(timeoutId);
                }

                if (!res.ok || !res.body) {
                  const errBody = await res.text().catch(() => '').then(t => t.slice(0, 120));
                  throw new Error(`Worker stream ${i + 1} failed (${res.status}): ${errBody}`);
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                const handleEvent = (line: string) => {
                  const trimmed = line.trim();
                  if (!trimmed) return;
                  if (trimmed.startsWith('data:')) {
                    adapter.processLine(trimmed.slice(5).trim());
                    return;
                  }
                  try {
                    adapter.processLine(trimmed);
                  } catch (e) {
                    console.debug('[useSSEStream] Ignored non-data line processing failure:', e);
                  }
                };

                try {
                  for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (currentSignal.aborted) { await reader.cancel(); break; }
                    buffer += decoder.decode(value, { stream: true });
                    const events = buffer.split(/\r?\n\r?\n/);
                    buffer = events.pop() || '';
                    for (const e of events) handleEvent(e);
                  }
                  if (buffer.trim()) handleEvent(buffer);
                } catch (readErr: any) {
                  if (readErr.name === 'AbortError') return;
                  throw readErr;
                } finally {
                  reader.releaseLock();
                }
              };

              const runStreams = async () => {
                const completedIndexes = new Set<number>();
                const failedIndexes = new Set<number>();

                const checkSettleState = () => {
                  if (hasSettled) return;
                  const totalSettled = completedIndexes.size + failedIndexes.size;
                  if (totalSettled === TOTAL_STREAMS) {
                    if (completedIndexes.size > 0) {
                      store.logOk(`${completedIndexes.size}/${TOTAL_STREAMS} streams completed.`);
                      settleAnalysis('complete');
                    } else {
                      settleAnalysis('error', 'All analysis streams failed.');
                    }
                  }
                };

                const handleStreamError = (i: number, error: string) => {
                  if (hasSettled) return;
                  failedIndexes.add(i);
                  if (ABORT_ON_PARTIAL_FAILURE) {
                    settleAnalysis('error', `Critical stream failure: [Bundle ${i + 1}] ${error}`);
                  } else {
                    checkSettleState();
                  }
                };

                const adapters: SynthesisStreamAdapter[] = [];
                const dimensionsList: number[][] = [];
                for (let i = 0; i < TOTAL_STREAMS; i++) {
                  const dimensions = STREAM_BUNDLES[i]!;
                  dimensionsList.push(dimensions);
                  adapters.push(new SynthesisStreamAdapter({
                    isPartialStream: true,
                    dimensions,
                    onError: (error) => {
                      if (currentSignal.aborted || hasSettled) return;
                      store.logError(`[Bundle ${i + 1}] error: ${error}`);
                      handleStreamError(i, error);
                    },
                    onComplete: () => {
                      if (currentSignal.aborted || hasSettled) return;
                      completedIndexes.add(i);
                      store.logOk(`[Bundle ${i + 1}] completed.`);
                      checkSettleState();
                    },
                  }));
                }

                store.logInfo(`Connecting to Cloudflare edge worker for parallel synthesis (${TOTAL_STREAMS} streams)...`);
                const streamFetches = adapters.map((adapter, i) =>
                  runSingleStream(i, dimensionsList[i]!, adapter, currentSignal, job, safeTimezone)
                );
                await Promise.all(
                  streamFetches.map((p, idx) => p.catch((err) => {
                    if (currentSignal.aborted || hasSettled) return;
                    store.logError(`Stream ${idx + 1} failed: ${err.message}`);
                    handleStreamError(idx, err.message);
                  }))
                );

                if (!hasSettled) checkSettleState();
              };

              // Execute parallel streams
              await Sentry.startSpan(
                { name: 'stream worker /analyze-llm-stream parallel', op: 'stream.parse' },
                async () => {
                  try {
                    await runStreams();
                  } catch (err: any) {
                    if (currentSignal.aborted || hasSettled) return;
                    store.logError(`Stream dispatch failed: ${err.message}`);
                    settleAnalysis('error', err.message);
                  }
                  if (!hasSettled) {
                    settleAnalysis('error', 'Analysis stream ended unexpectedly.');
                  }
                }
              );
            } catch (error) {
              if (error instanceof Error && error.name === 'AbortError') {
                // Quiet abort, do not report or show error
                return;
              }
              const errorMsg = error instanceof Error ? error.message : String(error);
              useAnalysisStore.getState().logError(`Client exception: ${errorMsg}`);
              setError({ code: 'ERR_CLIENT_EXCEPTION', status: 0, message: errorMsg });
              setStatus('error');
              Sentry.captureException(error);
            } finally {
              // Terminal cleanup: all async work has settled by here. Guarantees the main
              // action button is never left disabled after a partial/interrupted stream,
              // regardless of which exit path ran.
              if (abortControllerRef.current === myController) {
                setIsLoading(false);
              }
            }
          }
        );
      } finally {
        processingRef.current = false;
      }
    }, 0);
  };

  const stopAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setStatus('idle');
  };

  return { startAnalysis, stopAnalysis };
}
