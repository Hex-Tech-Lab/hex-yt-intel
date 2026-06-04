import * as Sentry from '@sentry/nextjs';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { SynthesisStreamAdapter } from '@/lib/adapters/synthesis-stream-adapter';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';

export function useSSEStream() {
  const {
    status,
    setIsLoading,
    setStatus,
    setError,
    initializeAnalysis,
    archiveCurrentAnalysis,
    setVideoMetadata,
  } = useAnalysisStore();

  const { initializeAnalysis: initSynthesis } = useSynthesisNucleus();

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
    const videoId = extractTelemetryId(url);
    const safeTimezone = /^[a-zA-Z0-9_/-]+$/.test(timezone) ? timezone : 'UTC';

    return Sentry.startSpan(
      {
        name: 'analyze_edge_stream',
        op: 'http.client',
        attributes: { videoId, timezone: safeTimezone, forceRefresh },
      },
      async () => {
        try {
          setIsLoading(true);
          setStatus('downloading');
          setError(null);

          // 1. Bouncer: auth + quota + ingestion. Returns 200 (cache) or 202 (job + token).
          const prepRes = await Sentry.startSpan(
            { name: 'POST /api/analyses', op: 'http.client' },
            async () => fetch('/api/analyses', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, timezone, forceRefresh }),
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
            setError({ code: errorCode, status: prepRes.status, message: errorMsg });
            setStatus('error');
            setIsLoading(false);
            return;
          }

          const job = await prepRes.json();

          // 2. Metadata extraction
          if (job.metadata) {
            setVideoMetadata(job.metadata);
          }

          // 3. Cache hit — render immediately.
          if (job.status === 'done' && job.markdown) {
            initializeAnalysis(job.analysisId || job.id, job.title || 'Analysis Result', job.markdown);
            initSynthesis(job);
            setStatus('complete');
            setIsLoading(false);
            archiveCurrentAnalysis();
            return;
          }

          // 3. Stream directly from the Cloudflare Worker (no Vercel in the LLM path).
          if (!job.stream?.url) {
            setError({ code: 'ERR_STREAM_UNCONFIGURED', status: 0, message: 'Streaming endpoint not configured (NEXT_PUBLIC_WORKER_URL).' });
            setStatus('error');
            setIsLoading(false);
            return;
          }

          initializeAnalysis(job.analysisId || job.id, job.title || 'Analysis Result');
          initSynthesis(job);
          setStatus('analyzing');

          let streamCompleted = false;
          const adapter = new SynthesisStreamAdapter({
            onError: (error) => {
              setError({ code: 'ERR_ANALYSIS_FAILED', status: 0, message: error });
              setStatus('error');
              setIsLoading(false);
            },
            onComplete: () => {
              streamCompleted = true;
              setStatus('complete');
              setIsLoading(false);
              archiveCurrentAnalysis();
            },
          });

          await Sentry.startSpan(
            { name: 'stream worker /analyze-llm-stream', op: 'stream.parse' },
            async () => {
              const res = await fetch(job.stream.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  videoId: job.videoId,
                  analysisId: job.analysisId || job.id,
                  transcript: job.transcript || '',
                  metadata: job.metadata,
                  persona: job.persona,
                  timezone: job.timezone || safeTimezone,
                  sig: job.stream.sig,
                  exp: job.stream.exp,
                }),
              });

              if (!res.ok || !res.body) {
                const errText = await res.text().catch(() => '');
                throw new Error(`Worker stream failed (${res.status}): ${errText.slice(0, 160)}`);
              }

              const reader = res.body.getReader();
              const decoder = new TextDecoder();
              let buffer = '';

              const handleEvent = (line: string) => {
                const trimmed = line.trim();
                if (!trimmed) return;

                // Parse SSE format: "data: {...}"
                if (trimmed.startsWith('data:')) {
                  const jsonStr = trimmed.slice(5).trim();
                  adapter.processLine(jsonStr);
                  return;
                }

                // Also handle raw JSON (if worker emits JSON directly)
                try {
                  adapter.processLine(trimmed);
                } catch {
                  // Not JSON, skip
                }
              };

              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const events = buffer.split('\n\n');
                buffer = events.pop() || '';
                for (const e of events) handleEvent(e);
              }
              if (buffer.trim()) handleEvent(buffer);

              // Stream closed without an explicit complete/error event.
              if (!streamCompleted && status !== 'error') {
                setError({ code: 'ERR_STREAM_INCOMPLETE', status: 0, message: 'The analysis stream ended unexpectedly. Please try again.' });
                setStatus('error');
                setIsLoading(false);
              }
            }
          );
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          setError({ code: 'ERR_CLIENT_EXCEPTION', status: 0, message: errorMsg });
          setStatus('error');
          setIsLoading(false);
          Sentry.captureException(error);
        }
      }
    );
  };

  return { startAnalysis };
}
