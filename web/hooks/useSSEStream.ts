import * as Sentry from '@sentry/nextjs';
import { useAnalysisStore } from '@/store/useAnalysisStore';

// Polling cadence for the async 202 + poll flow. A full free-model analysis takes
// ~41-47s, so poll every 3s for up to ~150s before giving up.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useSSEStream() {
  const {
    setIsLoading,
    setStatus,
    setError,
    initializeAnalysis,
    archiveCurrentAnalysis,
  } = useAnalysisStore();

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
        name: 'analyze_async_poll',
        op: 'http.client',
        attributes: { videoId, timezone: safeTimezone, forceRefresh },
      },
      async () => {
        try {
          setIsLoading(true);
          setStatus('downloading');
          setError(null);

          // 1. Kick off the job. Returns 202 {status:'processing'} or 200 {status:'done'} (cache hit).
          const response = await Sentry.startSpan(
            { name: 'POST /api/analyses', op: 'http.client' },
            async () => fetch('/api/analyses', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, timezone, forceRefresh }),
            })
          );

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            let errorMsg = errorData.message || errorData.error || `HTTP ${response.status}`;
            let errorCode = errorData.code || 'ERR_REQUEST_FAILED';

            if (response.status === 400 && errorData.details?.fieldErrors) {
              const fieldErrors = errorData.details.fieldErrors;
              errorCode = 'ERR_INVALID_REQUEST_SCHEMA';
              errorMsg = fieldErrors.url
                ? 'Invalid YouTube URL'
                : Object.entries(fieldErrors)
                    .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors[0] : errors}`)
                    .join('; ') || 'Invalid request';
            }

            setError({ code: errorCode, status: response.status, message: errorMsg });
            setStatus('error');
            setIsLoading(false);
            return;
          }

          const job = await response.json();
          const pollVideoId = job.videoId || videoId;

          // 2. Cache hit — analysis already complete, render immediately.
          if (job.status === 'done' && job.markdown) {
            initializeAnalysis(job.analysisId || job.id, job.title || 'Analysis Result', job.markdown);
            setStatus('complete');
            setIsLoading(false);
            archiveCurrentAnalysis();
            return;
          }

          // 3. Processing — poll the status endpoint until done/error/timeout.
          setStatus('analyzing');
          await Sentry.startSpan(
            { name: 'poll /api/analyses/check', op: 'http.poll' },
            async () => {
              for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
                await sleep(POLL_INTERVAL_MS);
                const pollRes = await fetch(`/api/analyses/check?videoId=${encodeURIComponent(pollVideoId)}`, {
                  credentials: 'include',
                });
                if (!pollRes.ok) continue; // transient; keep polling
                const data = await pollRes.json();

                if (data.status === 'done' && data.markdown) {
                  initializeAnalysis(data.analysisId || job.id, data.title || job.title || 'Analysis Result', data.markdown);
                  setStatus('complete');
                  setIsLoading(false);
                  archiveCurrentAnalysis();
                  return;
                }
                if (data.status === 'error') {
                  setError({ code: 'ERR_ANALYSIS_FAILED', status: 0, message: data.error || 'Analysis failed' });
                  setStatus('error');
                  setIsLoading(false);
                  return;
                }
                // status === 'processing' | 'none' → keep waiting
              }

              // Exhausted attempts without a terminal status.
              setError({ code: 'ERR_POLL_TIMEOUT', status: 0, message: 'Analysis is taking longer than expected. Please check back shortly.' });
              setStatus('error');
              setIsLoading(false);
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
