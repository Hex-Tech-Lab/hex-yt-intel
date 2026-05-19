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

  const startAnalysis = async (url: string, timezone: string) => {
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch?.[1] || 'unknown';
    const safeTimezone = /^[a-zA-Z0-9_/-]+$/.test(timezone) ? timezone : 'UTC';

    return Sentry.startSpan(
      {
        name: 'stream_analysis',
        op: 'http.client',
        attributes: { videoId, timezone: safeTimezone },
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
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, timezone }),
            })
          );

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error || `HTTP ${response.status}`;
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