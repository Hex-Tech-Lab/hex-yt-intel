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
 * Handles a single SSE/JSON line from the worker stream: `data:`-prefixed
 * lines have the prefix stripped before processing; anything else is passed
 * through verbatim with debug-only error tolerance (non-data lines like SSE
 * comments must not kill the stream). Extracted from runSingleStream
 * (PR #321 round-2: CodeFactor complex-method finding, behavior unchanged).
 */
function handleSseLine(line: string, adapter: SynthesisStreamAdapter): void {
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
}

/**
 * True when an SSE event frame carries a signal that the worker's CACHEABLE
 * LLM request has actually begun: the explicit `stage: 'llm-started'` status
 * frame, or (fallback for stale workers that predate the event) the first
 * LLM output delta. Raw early frames like the pre-transcript-fetch
 * `stage: 'extracting'` status deliberately do NOT qualify -- the prompt-cache
 * warm stagger must not release before bundle 1's cacheable request starts
 * (2026-09-26 fix: it previously released on the first raw SSE byte, so an
 * `extracting` frame could release the gate before the cache write began,
 * and bundles 2-5 would miss the warm cache).
 */
function isLlmSignalFrame(frame: string): boolean {
  for (const line of frame.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    try {
      const data = JSON.parse(trimmed.slice(5).trim()) as { type?: string; stage?: string };
      if (data.type === 'status' && data.stage === 'llm-started') return true;
      if (data.type === 'delta') return true;
    } catch (parseErr) {
      console.debug('[useSSEStream] Non-JSON data line -- not an LLM signal:', parseErr instanceof Error ? parseErr.message : String(parseErr));
    }
  }
  return false;
}

/**
 * Reads the worker stream body to completion, feeding every SSE event frame
 * to handleSseLine. Fires onLlmSignal exactly once, when the first
 * cacheable-LLM-start event frame arrives (see isLlmSignalFrame). A
 * user-intentional abort (AbortError) is quiet; any other read failure
 * propagates to the caller's retry/settle logic. Always releases the reader
 * lock.
 */
async function readSseBody(res: Response, adapter: SynthesisStreamAdapter, currentSignal: AbortSignal, onLlmSignal?: () => void): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (currentSignal.aborted) { await reader.cancel(); break; }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const e of events) {
        handleSseLine(e, adapter);
        if (onLlmSignal && isLlmSignalFrame(e)) {
          onLlmSignal();
          onLlmSignal = undefined;
        }
      }
    }
    if (buffer.trim()) {
      handleSseLine(buffer, adapter);
      if (onLlmSignal && isLlmSignalFrame(buffer)) {
        onLlmSignal();
        onLlmSignal = undefined;
      }
    }
  } catch (readErr: any) {
    if (readErr.name === 'AbortError') return;
    throw readErr;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Performs the worker stream fetch with handshake-timeout/error
 * classification. A 25s handshake window (streamController fires abort);
 * AbortError is classified as timeout vs user-intentional abort; raw
 * non-abort fetch failures get Sentry context (bundle index + worker host)
 * so transient connectivity blips are distinguishable from a systemic
 * worker outage. Returns the raw Response for the caller to validate.
 */
async function fetchWorkerStream(i: number, url: string, streamPayload: WorkerStreamRequest, combinedSignal: AbortSignal, streamController: AbortController): Promise<Response> {
  const timeoutId = setTimeout(() => streamController.abort(), 25000);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(streamPayload),
      signal: combinedSignal,
    });
  } catch (fetchErr: any) {
    const timedOut = streamController.signal.aborted;
    if (fetchErr.name === 'AbortError') {
      throw new Error(timedOut ? 'Handshake timed out after 25s.' : 'Request aborted.');
    }
    Sentry.captureException(fetchErr, {
      tags: { component: 'useSSEStream', phase: 'worker-fetch' },
      extra: { bundleIndex: i, workerHost: (() => { try { return new URL(url).host; } catch { return 'unknown'; } })() },
    });
    throw new Error(`Network error contacting worker (bundle ${i + 1}): ${fetchErr.message || fetchErr.name || 'unknown'}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// skipcq: JS-0067 -- React hook: a module-level ESM export, not a global-scope script declaration (DeepSource false positive)
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

  // skipcq: JS-0116 -- false positive: awaits live in the nested closures below (setTimeout/Sentry spans), not in this wrapper's own body
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
                initializeAnalysis(job.analysisId || job.id, job.title || 'Analysis Result', job.markdown, undefined, videoId);
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
              initializeAnalysis(job.analysisId || job.id, job.title || 'Analysis Result', undefined, undefined, videoId);
              // The description is real ingestion-time data (already fetched
              // by the bouncer before this stream even starts, see
              // WorkerIngestionAdapter.buildJobMetadata) -- wiring it in here
              // lets the Description aux chip reflect the truth immediately
              // instead of sitting idle for the whole streaming duration.
              // channelMeta/comments are NOT included: those are genuine LLM
              // synthesis output, only written by stitch-analysis-chunks.ts
              // once the analysis completes, so there's no honest data to
              // show for them yet -- leaving them unset (idle) here is
              // correct, not a gap (Cubic review follow-up, PR #214).
              initSynthesis(
                job.metadata?.description
                  ? { ...job, id: job.analysisId || job.id, analysisPayload: { videoMetadata: { description: job.metadata.description } } }
                  : job
              );
              setStatus('analyzing');

              let hasSettled = false;

              // skipcq: JS-R1005 -- settle logic is intentionally flat/readable at this complexity; splitting it would obscure the hasSettled invariants (DeepSource, PR #321 round-2)
              const settleAnalysis = (finalStatus: 'complete' | 'error', errorMsg?: string, successMsg?: string) => {
                if (hasSettled) return;
                hasSettled = true;
                activeAnalysisIdRef.current = null;

                if (finalStatus === 'complete') {
                  // RCA (2026-09-24): a 1/5 partial settle used to print
                  // "Analysis stream completed successfully." — success-washing
                  // a partial result. The final line now carries the real
                  // outcome (checkSettleState passes a partial message);
                  // settle semantics themselves are unchanged.
                  store.logOk(successMsg || 'Analysis stream completed successfully.');
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
                  // Write the terminal failure back to the DB row so a page
                  // refresh (or any other tab) sees the real outcome instead
                  // of a stale 'processing' row -- without this, only the
                  // ADR 007 reaper's delayed sweep would ever fix it (live-
                  // reported "amnesia" bug, 2026-08-15).
                  const failedAnalysisId = job.analysisId || job.id;
                  if (failedAnalysisId) {
                    fetch(`/api/analyses/${failedAnalysisId}/fail`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ reason: msg.slice(0, 500) }),
                      keepalive: true,
                    }).catch((e) => console.debug('[useSSEStream] Fail write-back failed (best-effort):', e));
                  }
                }
              };

              const runSingleStream = async (i: number, dimensions: number[], adapter: SynthesisStreamAdapter, currentSignal: AbortSignal, job: any, safeTimezone: string, attemptSignal?: AbortSignal, onLlmSignal?: () => void) => {
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
                  llmCascadeTimeoutMs: job.llmCascadeTimeoutMs,
                  llmCascadeHandshakeTimeoutMs: job.llmCascadeHandshakeTimeoutMs,
                  promptCaching: job.promptCaching,
                  cacheWarmTimeoutMs: job.cacheWarmTimeoutMs,
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

                const controller = new AbortController();
                currentSignal.addEventListener('abort', () => controller.abort(), { once: true });
                streamController.signal.addEventListener('abort', () => controller.abort(), { once: true });
                // Lets a retry actively cancel THIS specific attempt's own
                // fetch/reader (see attemptBundle/runBundleWithRetry below)
                // instead of leaving it running in the background alongside
                // a fresh attempt for the same bundle index once a mid-stream
                // adapter onError fires -- a bare onError callback gives no
                // guarantee the underlying stream has actually stopped.
                if (attemptSignal) {
                  if (attemptSignal.aborted) controller.abort();
                  else attemptSignal.addEventListener('abort', () => controller.abort(), { once: true });
                }

                const res = await fetchWorkerStream(i, job.stream.url, streamPayload, controller.signal, streamController);

                if (!res.ok || !res.body) {
                  const errBody = await res.text().catch(() => '').then(t => t.slice(0, 120));
                  throw new Error(`Worker stream ${i + 1} failed (${res.status}): ${errBody}`);
                }

                await readSseBody(res, adapter, currentSignal, onLlmSignal);
              };

              const runStreams = async () => {
                const completedIndexes = new Set<number>();
                const failedIndexes = new Set<number>();

                // Prompt-cache warm stagger (2026-09-25, release-condition
                // fixed 2026-09-26): Anthropic only makes a cache entry
                // readable once the FIRST request's response begins
                // streaming (their documented concurrent-requests caveat).
                // Bundle 0 starts immediately and resolves llmStartPromise
                // on the first signal that its CACHEABLE LLM request has
                // actually begun -- the worker's explicit `stage:
                // 'llm-started'` status frame, or the first LLM delta for
                // stale workers without the event. Raw early frames (the
                // pre-transcript `extracting` status) do NOT release the
                // gate: they can arrive well before the LLM request starts,
                // and releasing on them let bundles 2-5 start before the
                // cache write, missing the warm cache entirely. Bundles
                // 1..n wait at most cacheWarmTimeoutMs for that signal,
                // then start regardless -- a bounded wait, never a hard
                // gate. Skipped entirely when prompt caching is disabled
                // (nothing to warm, so the wait would be pure latency) or
                // for a single bundle.
                // 3000 fallback = measured Haiku 4.5 first-token latency
                // (2026-06-02 cascade benchmark; see migration derivation).
                // Explicit opt-in: only stagger when the job actually carries
                // promptCaching (CreateAnalysisUseCase always forwards the
                // registry-resolved flag) -- a stale client/job without the
                // field keeps the old all-parallel dispatch, so its bundles
                // are never silently held for the warm window.
                const warmTimeoutMs = typeof job.cacheWarmTimeoutMs === 'number' && job.cacheWarmTimeoutMs >= 0 ? job.cacheWarmTimeoutMs : 3000;
                const staggerEnabled = job.promptCaching === true && warmTimeoutMs > 0 && TOTAL_STREAMS > 1;
                let resolveLlmStart: (() => void) | undefined;
                const llmStartPromise = new Promise<void>((resolve) => { resolveLlmStart = resolve; });
                const awaitWarmGate = async (i: number) => {
                  if (!staggerEnabled || i === 0) return;
                  let timer: ReturnType<typeof setTimeout> | undefined;
                  try {
                    await Promise.race([
                      llmStartPromise,
                      new Promise<void>((resolve) => { timer = setTimeout(resolve, warmTimeoutMs); }),
                    ]);
                  } finally {
                    if (timer !== undefined) clearTimeout(timer);
                  }
                };
                const onBundle0LlmStart = () => {
                  if (resolveLlmStart) {
                    resolveLlmStart();
                    resolveLlmStart = undefined;
                  }
                };

                // skipcq: JS-R1005 -- intentional: single settle-check across both completed/failed indexes; splitting would race hasSettled (DeepSource, PR #321 round-2)
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
                      const isPartial = completedIndexes.size < TOTAL_STREAMS;
                      const completeMsg = isPartial
                        ? `Partial result: ${completedIndexes.size}/${TOTAL_STREAMS} streams completed; some dimensions are missing.`
                        : 'Analysis stream completed successfully.';
                      store.logOk(`${completedIndexes.size}/${TOTAL_STREAMS} streams completed.`);
                      settleAnalysis('complete', undefined, completeMsg);
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

                // One inline retry per bundle (same dimensions, same full
                // transcript context -- not narrowed to a single dimension)
                // before giving up on it. A bundle that fails twice stays out
                // of failedIndexes' way of the OTHER bundles (ABORT_ON_PARTIAL_
                // FAILURE default is now false, see synthesis.ts) and its
                // dimensions surface as missing on the persisted row --
                // dimension-remediation.ts's async cron (ADR 019) already
                // scans for exactly that (billing_status='failed' AND
                // validation_report.status='partial') and regenerates only
                // the still-missing dimensions, so there is no need for a
                // second, narrower-context retry mechanism here.
                //
                // attemptBundle resolves exactly once per attempt, from
                // whichever of the 3 signals arrives first: the adapter's
                // onComplete/onError callback (mid-stream, wire-level
                // outcome), or runSingleStream's own promise settling
                // (fetch/handshake failure, or -- rarely -- the reader
                // reaching `done` without ever seeing a terminal fragment).
                // runBundleWithRetry then AWAITS the (at most 2) attempts in
                // sequence, so the Promise.all below genuinely waits for the
                // retry to finish instead of racing an unawaited background
                // retry against the "did every bundle settle" check (a real
                // bug caught by this file's own regression test: the retry
                // used to fire detached, so the outer "stream ended
                // unexpectedly" fallback could settle the whole analysis
                // 'error' before the retry had a chance to complete).
                type BundleOutcome = { ok: true } | { ok: false; error: string; code?: string };

                // attemptController: caller-owned so a retry can explicitly
                // abort THIS attempt's own fetch/reader (see runSingleStream's
                // attemptSignal param) once its outcome is known, rather than
                // leaving it running in the background alongside the fresh
                // retry attempt -- an onError callback firing is not itself
                // proof the underlying stream has stopped.
                const attemptBundle = (i: number, dimensions: number[], attemptController: AbortController): Promise<BundleOutcome> => {
                  return new Promise<BundleOutcome>((resolve) => {
                    let settledLocal = false;
                    const resolveOnce = (result: BundleOutcome) => {
                      if (settledLocal) return;
                      settledLocal = true;
                      resolve(result);
                    };
                    const adapter = new SynthesisStreamAdapter({
                      isPartialStream: true,
                      dimensions,
                      onError: (error, code) => resolveOnce({ ok: false, error, code }),
                      onComplete: () => resolveOnce({ ok: true }),
                    });
                    runSingleStream(i, dimensions, adapter, currentSignal, job, safeTimezone, attemptController.signal, i === 0 ? onBundle0LlmStart : undefined)
                      .then(() => resolveOnce({ ok: false, error: 'Stream ended without a terminal signal.' }))
                      .catch((err: unknown) => resolveOnce({ ok: false, error: err instanceof Error ? err.message : String(err) }));
                  });
                };

                const runBundleWithRetry = async (i: number, dimensions: number[]) => {
                  // Cache-warm stagger applies to the FIRST attempt only --
                  // retries must never wait again.
                  await awaitWarmGate(i);
                  let attemptController = new AbortController();
                  let outcome = await attemptBundle(i, dimensions, attemptController);
                  if (!outcome.ok && !currentSignal.aborted && !hasSettled) {
                    // Stop the failed attempt's own stream before starting a
                    // fresh one for the same bundle index -- see the comment
                    // above attemptBundle.
                    attemptController.abort();
                    store.logError(`[Bundle ${i + 1}] failed, retrying once: ${outcome.error}`);
                    attemptController = new AbortController();
                    outcome = await attemptBundle(i, dimensions, attemptController);
                  }
                  if (currentSignal.aborted || hasSettled) return;
                  if (outcome.ok) {
                    completedIndexes.add(i);
                    store.logOk(`[Bundle ${i + 1}] completed.`);
                    checkSettleState();
                    return;
                  }
                  Sentry.captureException(new Error(outcome.error), {
                    tags: { component: 'useSSEStream', phase: 'stream-retry-exhausted' },
                    extra: { bundleIndex: i, code: outcome.code },
                  });
                  store.logError(`[Bundle ${i + 1}] error after retry: ${outcome.error}`);
                  handleStreamError(i, outcome.error, outcome.code);
                };

                const dimensionsList: number[][] = [];
                for (let i = 0; i < TOTAL_STREAMS; i++) {
                  dimensionsList.push(STREAM_BUNDLES[i]!);
                }

                store.logInfo(`Connecting to Cloudflare edge worker for parallel synthesis (${TOTAL_STREAMS} streams)...`);
                await Promise.all(
                  dimensionsList.map((dimensions, i) => runBundleWithRetry(i, dimensions))
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
                  // Guarded, matching every other settleAnalysis('error', ...)
                  // call site in this function: without the aborted check, an
                  // intentional user stop or component unmount -- which aborts
                  // currentSignal but leaves every per-bundle promise resolving
                  // quietly via its own AbortError guard, never touching
                  // completedIndexes/failedIndexes -- fell through to here and
                  // got persisted as a genuine terminal failure (real bug,
                  // caught by review on PR #234: intentional aborts must never
                  // reach settleAnalysis/POST /fail).
                  if (!hasSettled && !currentSignal.aborted) {
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
