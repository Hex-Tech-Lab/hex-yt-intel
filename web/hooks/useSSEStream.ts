import * as Sentry from '@sentry/nextjs';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { parseSSELine } from '@/lib/streaming/decoder';

export function useSSEStream() {
  const {
    setIsLoading,
    setStatus,
    setError,
    initializeAnalysis,
    appendMarkdown,
    archiveCurrentAnalysis,
  } = useAnalysisStore();

  const extractTelemetryId = (urlStr: string) => {
    try {
      const parsed = new URL(urlStr);
      if (parsed.hostname.includes('youtu.be')) return parsed.pathname.slice(1);
      if (parsed.pathname.includes('/embed/') || parsed.pathname.includes('/v/')) return parsed.pathname.split('/')[2];
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
        name: 'stream_analysis',
        op: 'http.client',
        attributes: { videoId, timezone: safeTimezone, forceRefresh },
      },
      async () => {
        try {
          setIsLoading(true);
          setStatus('downloading');
          setError(null);

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
            let errorMsg = errorData.error || `HTTP ${response.status}`;

            // Handle Zod validation errors (400 Bad Request with fieldErrors)
            if (response.status === 400 && errorData.details?.fieldErrors) {
              const fieldErrors = errorData.details.fieldErrors;
              if (fieldErrors.url) {
                errorMsg = 'Invalid YouTube URL';
              } else {
                errorMsg = Object.entries(fieldErrors)
                  .map(([field, errors]) => `${field}: ${Array.isArray(errors) ? errors[0] : errors}`)
                  .join('; ') || 'Invalid request';
              }
            }

            setError(errorMsg);
            setStatus('error');
            setIsLoading(false);
            return;
          }

          setStatus('parsing');

          const contentType = response.headers.get('content-type') || '';
          const isSSEStream = contentType.includes('text/event-stream');

          if (isSSEStream) {
            const reader = response.body?.getReader();
            if (!reader) throw new Error('Response body not readable');

            // Hydrate true native identifiers from endpoint
            const analysisId = response.headers.get('X-Analysis-Id') || url;
            const encodedTitle = response.headers.get('X-Title');
            const title = encodedTitle ? decodeURIComponent(encodedTitle) : 'Analysis Result';

            initializeAnalysis(analysisId, title);
            setStatus('analyzing');

            await Sentry.startSpan(
              { name: 'consume SSE stream', op: 'stream.parse' },
              async () => {
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    if (buffer.trim()) {
                      const token = parseSSELine(buffer);
                      if (token) appendMarkdown(token);
                    }
                    break;
                  }

                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || ''; 

                  for (const line of lines) {
                    const token = parseSSELine(line);
                    if (token) appendMarkdown(token);
                  }
                }
              }
            );
          } else {
            setStatus('analyzing');
            const jsonData = await response.json();
            if (jsonData.markdown) {
              initializeAnalysis(jsonData.analysisId || jsonData.id, jsonData.title || 'Analysis Result', jsonData.markdown);
            } else if (jsonData.error) {
              throw new Error(jsonData.error);
            } else {
              throw new Error('Invalid response format');
            }
          }

          setStatus('complete');
          setIsLoading(false);
          archiveCurrentAnalysis();
          Sentry.captureMessage('Analysis completed successfully', 'info');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          setError(errorMsg);
          setStatus('error');
          setIsLoading(false);
          Sentry.captureException(error);
        }
      }
    );
  };

  return { startAnalysis };
}