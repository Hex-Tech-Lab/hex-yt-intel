import { addBreadcrumb } from '@sentry/cloudflare';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { TranscriptExtractor, parseChainBudgetMs } from '../services/TranscriptExtractor';
import { YouTubeNativeTranscriptProvider } from '../services/providers/YouTubeNativeTranscriptProvider';
import { NoCaptionsConfirmedError } from '../ports/TranscriptProviderPort';

// Mock Sentry
vi.mock('@sentry/cloudflare', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
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

    // Force every provider in the chain to fail
    (extractor as any).buildProviders = () => [
      { name: 'apify', provider: { fetch: vi.fn().mockRejectedValue(new Error('Apify fail')) } },
      { name: 'decodo', provider: { fetch: vi.fn().mockRejectedValue(new Error('Decodo fail')) } },
      { name: 'native', provider: { fetch: vi.fn().mockRejectedValue(new Error('Native fail')) } },
    ];

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

    const extractor = new YouTubeNativeTranscriptProvider();

    // Call fetchTranscriptContent which should catch the timeout and report to Sentry
    await expect((extractor as any).fetchTranscriptContent(videoId, langCode)).rejects.toThrow();

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

    const extractor = new YouTubeNativeTranscriptProvider();

    // Call fetchTranscriptContent which should catch the error and report to Sentry
    await expect((extractor as any).fetchTranscriptContent(videoId, langCode)).rejects.toThrow();

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

    const extractor = new YouTubeNativeTranscriptProvider();

    await expect((extractor as any).fetchTranscriptContent(videoId, langCode)).rejects.toThrow();

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

describe('parseProviderOrder invalid-entry handling', () => {
  it('parses a fully valid list unchanged', () => {
    expect(TranscriptExtractor.parseProviderOrder('decodo,apify')).toEqual(['decodo', 'apify']);
    expect(TranscriptExtractor.parseProviderOrder('native')).toEqual(['native']);
  });

  it('drops unknown names with a warning and a Sentry breadcrumb naming the invalid entry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(TranscriptExtractor.parseProviderOrder('apify,decodo,nativ')).toEqual(['apify', 'decodo']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('nativ'));
      expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
        level: 'warning',
        message: 'Unknown transcript provider in TRANSCRIPT_PROVIDER_ORDER',
        data: expect.objectContaining({ invalid: 'nativ' }),
      }));
    } finally {
      warn.mockRestore();
    }
  });

  it('falls back to the default order when every entry is invalid (and warns)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(TranscriptExtractor.parseProviderOrder('foo,bar')).toEqual(['transcriptapi', 'apify', 'decodo', 'native', 'supadata']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ invalid: 'foo,bar' }),
      }));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('TranscriptExtractor chain budget', () => {
  it('a slow (self-aborting at 130s-style) Apify tier leaves the later provider within budget', async () => {
    vi.useFakeTimers();
    try {
      const extractor = new TranscriptExtractor(undefined, undefined, 'apify,decodo', undefined, 5000);
      (extractor as any).buildProviders = () => [
        // Models the real Apify tier: aborts itself at 130000ms (here 3000
        // under the test's 5000ms budget), then the chain falls through and
        // decodo must finish within the REMAINING budget.
        { name: 'apify', provider: { fetch: () => new Promise((neverResolve, reject) => setTimeout(() => reject(new Error('apify aborted')), 3000)) } },
        { name: 'decodo', provider: { fetch: vi.fn().mockResolvedValue({ videoId: 'VALID_ID_12', transcript: 'from decodo', language: 'en' }) } },
      ];
      const pending = extractor.fetch('VALID_ID_12');
      await vi.advanceTimersByTimeAsync(4000);
      const result = await pending;
      expect(result.transcript).toBe('from decodo');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stalled provider is hard-aborted at the budget and the rest are skipped with the placeholder', async () => {
    vi.useFakeTimers();
    try {
      const extractor = new TranscriptExtractor(undefined, undefined, 'apify,decodo', undefined, 5000);
      const decodoFetch = vi.fn().mockResolvedValue({ videoId: 'VALID_ID_12', transcript: 'from decodo', language: 'en' });
      (extractor as any).buildProviders = () => [
        { name: 'apify', provider: { fetch: () => new Promise(() => {}) } },
        { name: 'decodo', provider: { fetch: decodoFetch } },
      ];
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const pending = extractor.fetch('VALID_ID_12');
        await vi.advanceTimersByTimeAsync(5000);
        const result = await pending;
        expect(result.transcript).toContain('Transcript unavailable');
        // The stalled provider is recorded as a budget-exceeded failure
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('chain budget'));
        // Budget fully consumed → decodo skipped, not called
        expect(decodoFetch).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('parseChainBudgetMs rejects non-numeric / non-positive values', () => {
    expect(parseChainBudgetMs(undefined)).toBeUndefined();
    expect(parseChainBudgetMs('abc')).toBeUndefined();
    expect(parseChainBudgetMs('0')).toBeUndefined();
    expect(parseChainBudgetMs('-5')).toBeUndefined();
    expect(parseChainBudgetMs('120000')).toBe(120000);
  });
});

describe('confirmedNoCaptions contract (end to end through the real native provider)', () => {
  it('native confirms zero caption tracks on both sub-sources → placeholder marked confirmed', async () => {
    const { fetchWithProxy } = await import('../services/http-utils');
    (fetchWithProxy as any).mockImplementation((url: string) => {
      const urlText = String(url);
      if (urlText.includes('type=list')) {
        // Caption-list API: valid XML, but zero tracks
        return Promise.resolve({ ok: true, text: () => Promise.resolve('<?xml version="1.0"?><transcript_list/>') });
      }
      // Watch page: valid HTML with no captionTracks at all
      return Promise.resolve({ ok: true, text: () => Promise.resolve('<html><body>no captions here</body></html>') });
    });
const extractor = new TranscriptExtractor(undefined, undefined, 'native', undefined);
    try {
      const result = await extractor.fetch('VALID_ID_12');
      expect(result.confirmedNoCaptions).toBe(true);
      expect(result.transcript).toBe('[No captions available for this video]');
    } finally {
      // Cleanup: drop the network mock so later tests start clean
      (fetchWithProxy as Mock).mockReset();
    }
  });


  it('native fails for unrelated reasons (timeout on both sub-sources) → placeholder unconfirmed', async () => {
    const { fetchWithProxy } = await import('../services/http-utils');
    const { captureMessage } = await import('@sentry/cloudflare');
    const timeoutError = new Error('The operation was aborted.');
    timeoutError.name = 'TimeoutError';
    (fetchWithProxy as any).mockRejectedValue(timeoutError);

    const extractor = new TranscriptExtractor(undefined, undefined, 'native', undefined);
    try {
      const result = await extractor.fetch('VALID_ID_12');
      expect(result.confirmedNoCaptions).toBe(false);
      expect(result.transcript).toBe('[Transcript unavailable for this video - content ingestion failed across all available sources]');
      expect(captureMessage).toHaveBeenCalledWith('Transcript pipeline exhausted for VALID_ID_12', expect.objectContaining({ level: 'error' }));
    } finally {
      (fetchWithProxy as Mock).mockReset();
    }
  });

  it('native content-fetch stall falls through to the next provider in the chain', async () => {
    const { fetchWithProxy } = await import('../services/http-utils');
    (fetchWithProxy as any).mockImplementation((url: string) => {
      const urlText = String(url);
      if (urlText.includes('type=list')) return Promise.reject(new Error('caption list api down'));
      if (urlText.includes('watch?v=')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('x"captionTracks": [{"baseUrl":"https://www.youtube.com/api/timedtext?v=VALID_ID_12&lang=en","langCode":"en","kind":"asr"}],'),
        });
      }
      // Transcript content fetch stalls forever (P1 scenario): reject with a
      // timeout-shaped error at the provider's 15s deadline.
      return new Promise((neverResolve, reject) => {
        setTimeout(() => {
          const err = new Error('The operation was aborted.');
          err.name = 'TimeoutError';
          reject(err);
        }, 15000);
      });
    });

    const decodoResult = { videoId: 'VALID_ID_12', transcript: 'from decodo', language: 'en' };
    const extractor = new TranscriptExtractor(undefined, undefined, 'native,decodo', undefined);
    (extractor as any).buildProviders = () => [
      { name: 'native', provider: new YouTubeNativeTranscriptProvider() },
      { name: 'decodo', provider: { fetch: vi.fn().mockResolvedValue(decodoResult) } },
    ];

    vi.useFakeTimers();
    try {
      const pending = extractor.fetch('VALID_ID_12');
      await vi.advanceTimersByTimeAsync(15000);
      const result = await pending;
      expect(result.transcript).toBe('from decodo');
      const { captureException } = await import('@sentry/cloudflare');
      expect(captureException).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tags: expect.objectContaining({ operation: 'transcript-page-html' }) }));
    } finally {
      vi.useRealTimers();
    }
  });
});
