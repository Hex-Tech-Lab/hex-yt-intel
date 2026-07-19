import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptExtractor } from '../services/TranscriptExtractor';

// Mock Sentry
vi.mock('@sentry/cloudflare', () => ({
  captureException: vi.fn(),
}));

// Mock http-utils and user-agent
vi.mock('../services/http-utils', () => ({
  fetchWithProxy: vi.fn(),
}));

vi.mock('../services/user-agent', () => ({
  getRandomUserAgent: vi.fn(() => 'Mozilla/5.0'),
}));

describe('TranscriptExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should fallback to tertiary if primary and secondary fail', async () => {
    const extractor = new TranscriptExtractor();

    // Force Primary and Decodo to fail
    (extractor as any).fetchWithPrimary = vi.fn().mockRejectedValue(new Error('Primary fail'));
    (extractor as any).fetchWithDecodo = vi.fn().mockRejectedValue(new Error('Decodo fail'));

    let result;
    try {
      result = await extractor.fetch('VALID_ID_12');
    } finally {
      // cleanup mock state
    }

    expect(result.transcript).toContain('Transcript unavailable');
    expect(result.language).toBe('en');
  });

  it('should report timeout errors to Sentry when fetchTranscriptContent times out', async () => {
    const { captureException } = await import('@sentry/cloudflare');
    const { fetchWithProxy } = await import('../services/http-utils');

    const videoId = 'test_video_123';
    const langCode = 'en';

    // Mock fetchWithProxy to throw a timeout error (AbortSignal.timeout throws TimeoutError)
    const timeoutError = new Error('The operation was aborted.');
    timeoutError.name = 'TimeoutError';
    (fetchWithProxy as any).mockRejectedValue(timeoutError);

    const extractor = new TranscriptExtractor();

    // Call fetchTranscriptContent which should catch the timeout and report to Sentry
    try {
      await (extractor as any).fetchTranscriptContent(videoId, langCode);
    } catch (e) {
      // Expected to throw after reporting
    }

    // Verify captureException was called with the timeout error and correct tags
    expect(captureException).toHaveBeenCalledWith(timeoutError, {
      tags: {
        operation: 'transcript-content-fetch',
        videoId,
      },
    });

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('should report non-timeout errors to Sentry when fetchTranscriptContent fails', async () => {
    const { captureException } = await import('@sentry/cloudflare');
    const { fetchWithProxy } = await import('../services/http-utils');

    const videoId = 'test_video_456';
    const langCode = 'en';
    const fetchError = new Error('Transcript content fetch failed: 404');

    (fetchWithProxy as any).mockRejectedValue(fetchError);

    const extractor = new TranscriptExtractor();

    // Call fetchTranscriptContent which should catch the error and report to Sentry
    try {
      await (extractor as any).fetchTranscriptContent(videoId, langCode);
    } catch (e) {
      // Expected to throw after reporting
    }

    // Verify captureException was called with the error and correct tags
    expect(captureException).toHaveBeenCalledWith(fetchError, {
      tags: {
        operation: 'transcript-content-fetch',
        videoId,
      },
    });

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('should report empty transcript data errors to Sentry', async () => {
    const { captureException } = await import('@sentry/cloudflare');
    const { fetchWithProxy } = await import('../services/http-utils');

    const videoId = 'test_video_789';
    const langCode = 'en';

    // Mock fetchWithProxy to return a successful response but with empty events
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ events: [] }),
    };
    (fetchWithProxy as any).mockResolvedValue(mockResponse);

    const extractor = new TranscriptExtractor();

    try {
      await (extractor as any).fetchTranscriptContent(videoId, langCode);
    } catch (e) {
      // Expected to throw after reporting
    }

    // Verify captureException was called
    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, context] = (captureException as any).mock.calls[0];
    expect(error.message).toContain('Transcript data structure empty');
    expect(context.tags).toEqual({
      operation: 'transcript-content-fetch',
      videoId,
    });
  });
});
