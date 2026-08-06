import { useRef, useEffect, useState } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useChatStore } from '@/store/useChatStore';
import { useVideoStore } from '@/store/useVideoStore';
import { useChaptersStore } from '@/store/useChaptersStore';
import { SynthesisStreamAdapter } from '@/lib/adapters/synthesis-stream-adapter';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import type { WorkerStreamRequest } from '@/lib/types/contracts';
import { useSynthesisConfig } from '@/lib/config/synthesis-with-settings';
import { extractVideoId } from '@/lib/youtube';
import { findMatchingConversation } from '@/lib/utils/find-chat-conversation';

/**
 * Hook managing Server-Sent Event streaming for analysis generation.
 * Orchestrates stream initiation, chunk collection, polling, and result assembly.
 * Handles interruption recovery, stream backpressure, and error propagation.
 * @returns Object with startAnalysis and stopAnalysis functions for stream control
 */
export function useSSEStream() {
  const config = useSynthesisConfig();
  const TOTAL_STREAMS = config.totalStreams;
  const STREAM_BUNDLES = config.streamBundles;
  const ABORT_ON_PARTIAL_FAILURE = config.abortOnPartialFailure;

  // Validate that stream config is properly loaded (prevents timing mismatches)
  if ((!STREAM_BUNDLES || STREAM_BUNDLES.length === 0) && typeof window !== 'undefined' && window.__CHAT_DEBUG) {
    console.warn('[useSSEStream] Stream config not initialized, check settings load timing');
  }

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
  // Snapshot of the analysisId THIS hook instance's own stream is running,
  // captured at stream start -- deliberately not read live from the store in
  // stopAnalysis, because navigating to a different analysis (e.g. clicking
  // a history item) while this stream is still in flight repoints the store
  // to that other analysis's id without stopping this stream (processingRef
  // only blocks starting a NEW stream, not the store being repointed). A
  // live store read in stopAnalysis would then send the cancel signal to the
  // wrong analysis.
  const activeAnalysisIdRef = useRef<string | null>(null);
  const processingRef = useRef(false);
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const startAnalysis = async (url: string, timezone: string, forceRefresh: boolean = false) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsLiveStreaming(true);

    // 1. Abort any previous stream to prevent bifurcation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const videoId = extractVideoId(url);
    // Merge with existing metadata (preserves eagerly-fetched data from useEagerVideoMetadata)
    const prev = useAnalysisStore.getState().videoMetadata;
    const isSameVideo = prev?.videoId === videoId;
    const preservedMetadata = {
      videoId,
      title: isSameVideo ? (prev?.title || '') : '',
      channelTitle: isSameVideo ? (prev?.channelTitle || '') : '',
      channelId: isSameVideo ? (prev?.channelId || '') : '',
      publishedAt: isSameVideo ? (prev?.publishedAt || '') : '',
      duration: isSameVideo ? prev?.duration : null,
      viewCount: isSameVideo ? (prev?.viewCount || '') : '',
      likeCount: isSameVideo ? (prev?.likeCount || '') : '',
      commentCount: isSameVideo ? (prev?.commentCount || '') : '',
      thumbnailUrl: isSameVideo ? prev?.thumbnailUrl : null,
    };
    const safeTimezone = /^[a-zA-Z0-9_/-]+$/.test(timezone) ? timezone : 'UTC';

    const myController = new AbortController();
    abortControllerRef.current = myController;
    const currentSignal = myController.signal;

    // Clear analysis but preserve video metadata & chat thread when re-analyzing same video
    clearAnalysis();
    setVideoMetadata(preservedMetadata);
    resetSynthesis();
    if (!isSameVideo) {
      useChatStore.getState().reset();
      useVideoStore.getState().reset();
    }
    // Bust the chapters cache on a different video, or a forced re-analysis of
    // the same video (its description/chapters may have changed since the
    // last cached read) — not on a plain retry of the same video, which
    // should keep serving the already-loaded/cached entry.
    if (!isSameVideo || forceRefresh) {
      useChaptersStore.getState().reset(videoId);
    }
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

              // Log stream config to detect timing mismatches between client/server expectations
              if (typeof window !== 'undefined' && window.__CHAT_DEBUG) {
                console.debug('[useSSEStream] Analysis stream config', {
                  totalStreams: TOTAL_STREAMS,
                  bundleCount: STREAM_BUNDLES?.length,
                  abortOnPartialFailure: ABORT_ON_PARTIAL_FAILURE,
                  workerUrl: job.stream.url.substring(0, 50),
                });
              }

              store.logInfo(`Connecting to Cloudflare edge worker for unified intelligence synthesis...`);
              activeAnalysisIdRef.current = job.analysisId || job.id;
              initializeAnalysis(job.analysisId || job.id, job.title || 'Analysis Result');
              initSynthesis(job);
              setStatus('analyzing');

              let hasSettled = false;

              const settleAnalysis = (finalStatus: 'complete' | 'error', errorMsg?: string) => {
                if (hasSettled) return;
                hasSettled = true;
                activeAnalysisIdRef.current = null;

                if (finalStatus === 'complete') {
                  store.logOk(`Analysis stream completed successfully.`);
                  useSynthesisNucleus.getState().completeAnalysis();
                  setStatus('complete');
                  setIsLoading(false);
                  archiveCurrentAnalysis();
                  void (async () => {
                    try {
                      // Bumped as early as possible so a still-in-flight
                      // OLDER stream's later updateConversationAnalysisId
                      // call sees a stale epoch and no-ops its PATCH (see
                      // restoreEpoch doc, useChatStore.ts).
                      const epoch = useChatStore.getState().beginRestoreEpoch();
                      // `abortControllerRef.current !== myController` alone
                      // doesn't catch unmount/navigation: the cleanup effect
                      // only calls `.abort()` on the controller, it never
                      // reassigns the ref, so identity still matches after
                      // unmount. `myController.signal.aborted` catches that
                      // case too. Also checks the SHARED restoreEpoch, not
                      // just this stream's own controller state -- a
                      // different restore call site (ChatDock, History,
                      // useAutoRestoreAnalysis) can supersede this one even
                      // while this stream's own controller is still live
                      // (cubic review, PR #177).
                      const isStale = () =>
                        myController.signal.aborted ||
                        abortControllerRef.current !== myController ||
                        useChatStore.getState().restoreEpoch !== epoch;
                      await useChatStore.getState().loadConversations();
                      if (isStale()) return;
                      const chatStore = useChatStore.getState();
                      const currentVid = job.videoId;
                      const currentAnalId = job.analysisId || job.id;
                      // Delegates to the shared matcher (archived-suffix stripping +
                      // priority ordering) rather than a hand-rolled copy.
                      const existingConv = findMatchingConversation(chatStore.conversations, currentAnalId, currentVid);
                      if (existingConv) {
                        if (existingConv.analysisId !== currentAnalId) {
                          await chatStore.updateConversationAnalysisId(existingConv.id, currentAnalId, { epoch });
                        }
                        if (isStale()) return;
                        await chatStore.selectConversation(existingConv.id);
                      }
                    } catch (e) {
                      console.debug('[useSSEStream] Post-analysis chat reload failed:', e);
                    }
                  })();
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
                  userId: job.userId,
                  transcript: job.transcript || '',
                  segments: job.segments,
                  metadata: job.metadata,
                  persona: job.persona,
                  timezone: job.timezone || safeTimezone,
                  models: job.models,
                  cascade: job.cascade,
                  maxOutputTokens: job.maxOutputTokens,
                  sig: job.stream.sig,
                  exp: job.stream.exp,
                  appUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
                  dimensions,
                  chunkIndex: i + 1,
                  totalChunks: TOTAL_STREAMS,
                  commentsConfig: job.commentsConfig,
                  channelMetaConfig: job.channelMetaConfig,
                  commentsSamplePlan: job.commentsSamplePlan,
                  commentsSyncPoolConfig: job.commentsSyncPoolConfig,
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
                  // Raw browser fetch failures (TypeError: Failed to fetch, etc.)
                  // give no RCA signal on their own -- capture with bundle/host
                  // context so transient connectivity blips are distinguishable
                  // from a systemic worker outage in Sentry.
                  Sentry.captureException(fetchErr, {
                    tags: { component: 'useSSEStream', phase: 'worker-fetch' },
                    extra: { bundleIndex: i, workerHost: (() => { try { return new URL(job.stream.url).host; } catch { return 'unknown'; } })() },
                  });
                  throw new Error(`Network error contacting worker (bundle ${i + 1}): ${fetchErr.message || fetchErr.name || 'unknown'}`);
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
                  if (typeof window !== 'undefined' && window.__CHAT_DEBUG) {
                    console.debug('[useSSEStream] Stream state check', {
                      completed: completedIndexes.size,
                      failed: failedIndexes.size,
                      expected: TOTAL_STREAMS,
                      settled: totalSettled === TOTAL_STREAMS,
                    });
                  }
                  if (totalSettled === TOTAL_STREAMS) {
                    if (completedIndexes.size > 0) {
                      store.logOk(`${completedIndexes.size}/${TOTAL_STREAMS} streams completed.`);
                      settleAnalysis('complete');
                    } else {
                      settleAnalysis('error', 'All analysis streams failed.');
                    }
                  }
                };

                const handleStreamError = (i: number, error: string, code?: string) => {
                  if (hasSettled) return;
                  failedIndexes.add(i);
                  // A missing transcript is deterministic for the whole video —
                  // every bundle fetches the same transcript, so all five fail
                  // identically. Surface a clear, actionable message (the video
                  // simply has no captions — common for Shorts) instead of an
                  // alarming "Critical stream failure [Bundle N]". Prefer the
                  // stable worker code; fall back to text only for older frames.
                  const isNoTranscript =
                    code === 'ERR_NO_TRANSCRIPT' || /no transcript available|transcript unavailable/i.test(error);
                  if (isNoTranscript) {
                    settleAnalysis(
                      'error',
                      "This video has no captions or transcript available, so it can't be analyzed. YouTube Shorts and some uploads don't include subtitles — try a video that offers a CC (captions) track.",
                    );
                    return;
                  }
                  // Distinct from the above: our transcript extraction
                  // pipeline (Decodo + YouTube fallbacks) failed to reach an
                  // answer at all -- this video may well have captions, we
                  // just couldn't fetch them right now. Different advice:
                  // retry this same video, not "try a different one."
                  if (code === 'ERR_TRANSCRIPT_PIPELINE_UNAVAILABLE') {
                    settleAnalysis(
                      'error',
                      "We couldn't retrieve this video's transcript right now — this looks like a temporary issue on our end, not a problem with the video. Please try again in a few minutes.",
                    );
                    return;
                  }
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
                    onError: (error, code) => {
                      if (currentSignal.aborted || hasSettled) return;
                      store.logError(`[Bundle ${i + 1}] error: ${error}`);
                      handleStreamError(i, error, code);
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
                    // Non-fetch failures (stream read errors, JSON parse
                    // failures inside the reader loop) never pass through the
                    // worker-fetch Sentry.captureException above -- capture
                    // here too so every settle-on-error path has telemetry,
                    // not just the initial connection.
                    Sentry.captureException(err, {
                      tags: { component: 'useSSEStream', phase: 'stream-runtime' },
                      extra: { bundleIndex: idx },
                    });
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
        setIsLiveStreaming(false);
      }
    }, 0);
  };

  const stopAnalysis = () => {
    // ADR 020 Phase 1: explicit cancel signal, fire-and-forget -- distinct
    // from the abortControllerRef.current.abort() below, which only stops
    // THIS client's own connection (the worker deliberately ignores that,
    // see the 2026-07-29 httpConnSignal decoupling that lets a stream
    // survive plain navigation-away). This POST tells the worker the user
    // explicitly wants generation stopped, via a Redis flag it polls.
    //
    // Uses activeAnalysisIdRef (snapshotted at stream start), NOT a live
    // store read: processingRef only blocks starting a NEW stream while one
    // is in flight, it does NOT stop the store being repointed to a
    // different analysis (e.g. clicking a history item) while this stream
    // keeps running in the background. A live read here could cancel the
    // wrong analysis.
    const cancelAnalysisId = activeAnalysisIdRef.current;
    if (cancelAnalysisId) {
      // keepalive: true -- a user clicking stop often navigates away
      // immediately after; without this, some browsers cancel an in-flight
      // fetch on unmount/navigation before the POST reaches the server,
      // silently defeating the exact scenario this signal exists for.
      fetch(`/api/analyses/${cancelAnalysisId}/cancel`, { method: 'POST', keepalive: true }).catch((err) => {
        console.debug('[useSSEStream] Cancel signal failed to send (best-effort):', err);
      });
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    activeAnalysisIdRef.current = null;
    processingRef.current = false;
    setIsLiveStreaming(false);
    setIsLoading(false);
    setStatus('idle');
  };

  return { startAnalysis, stopAnalysis, isLiveStreaming };
}
