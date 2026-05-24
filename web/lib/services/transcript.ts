import { env } from '@/lib/env';

interface TranscriptProxyResponse {
  success: boolean;
  transcript?: string;
  language?: string;
  length?: number;
  reason?: string;
}

const getBaseUrl = (): string => {
  const siteUrl = env.appUrl;
  if (!siteUrl) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL environment variable is required for transcript proxy requests'
    );
  }
  return siteUrl;
};

export async function fetchTranscript(videoId: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const baseUrl = getBaseUrl();
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const transcriptProxyUrl = `${baseUrl}/api/transcript-proxy`;

    try {
      const response = await fetch(transcriptProxyUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: videoUrl }),
      });

      const data = (await response.json()) as TranscriptProxyResponse;

      if (!response.ok || !data.success) {
        if (response.status === 404) {
          throw new Error(
            `Video transcript not found (404): ${data.reason || 'captions unavailable or video inaccessible'}`
          );
        }
        throw new Error(`Failed to fetch transcript: ${data.reason || `HTTP ${response.status}`}`);
      }

      if (!data.transcript || typeof data.transcript !== 'string') {
        throw new Error('Transcript proxy returned invalid format');
      }

      return data.transcript;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error fetching transcript';
      throw new Error(`Transcript fetch failed: ${errorMsg}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[fetchTranscript] CRITICAL:', errorMsg);
    throw new Error(`Failed to fetch transcript: ${errorMsg}`);
  } finally {
    clearTimeout(timeout);
  }
}
