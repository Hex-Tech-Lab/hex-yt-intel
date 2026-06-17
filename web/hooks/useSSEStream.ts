import { useRef, useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { SynthesisStreamAdapter } from '@/lib/adapters/synthesis-stream-adapter';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import type { WorkerStreamRequest } from '@/lib/types/contracts';

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
    } catch {
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
    const safeTimezone = /^[a-zA-Z0-9_/-]+$/.test(timezone) ? timezone : 'UTC';

    const myController = new AbortController();
    abortControllerRef.current = myController;
    const currentSignal = myController.signal;

    try {
      return await Sentry.startSpan(
      {
        name: 'analyze_edge_stream',
        op: 'http.client',
        attributes: { videoId, timezone: safeTimezone, forceRefresh },
      },
      async () => {
        try {
          clearAnalysis();
          resetSynthesis();

          setIsLoading(true);
          setStatus('downloading');
          setError(null);

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

          const runStream = async () => {
            const adapter = new SynthesisStreamAdapter({
              isPartialStream: false,
              onError: (error) => {
                if (currentSignal.aborted || hasSettled) return;
                store.logError(`Stream error: ${error}`);
                settleAnalysis('error', `Critical stream failure: ${error}`);
              },
              onComplete: () => {
                if (currentSignal.aborted || hasSettled) return;
                store.logOk(`Streaming completed.`);
                settleAnalysis('complete');
              }
            });

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
              // chunkIndex omitted for full single-stream synthesis
            };

            // Harden fetch with 10s timeout for handshake
            const timeoutId = setTimeout(() => {
              if (!hasSettled) myController.abort();
            }, 10000);

            let res;
            try {
              res = await fetch(job.stream.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(streamPayload),
                signal: currentSignal,
              });
            } finally {
              clearTimeout(timeoutId);
            }

            if (!res.ok || !res.body) {
              const errText = await res.text().catch(() => '');
              const msg = `Worker stream failed (${res.status}): ${errText.slice(0, 160)}`;
              throw new Error(msg);
            }

            store.logInfo(`Handshaked with edge node. Streaming intelligence...`);

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            const handleEvent = (line: string) => {
              const trimmed = line.trim();
              if (!trimmed) return;

              if (trimmed.startsWith('data:')) {
                const jsonStr = trimmed.slice(5).trim();
                adapter.processLine(jsonStr);
                return;
              }

              try {
                adapter.processLine(trimmed);
              } catch {
                // Not JSON, skip
              }
            };

            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (currentSignal.aborted) {
                  await reader.cancel();
                  break;
                }
                buffer += decoder.decode(value, { stream: true });
                const events = buffer.split('\n\n');
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

          // Execute single unified stream
          await Sentry.startSpan(
            { name: 'stream worker /analyze-llm-stream unified', op: 'stream.parse' },
            async () => {
              try {
                await runStream();
              } catch (err: any) {
                if (currentSignal.aborted || hasSettled) return;
                store.logError(`Stream dispatch failed: ${err.message}`);
                settleAnalysis('error', err.message);
              }

              // Interrupted check / fallback settle
              if (!hasSettled) {
                settleAnalysis('error', 'Analysis stream ended unexpectedly. Please try again.');
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
