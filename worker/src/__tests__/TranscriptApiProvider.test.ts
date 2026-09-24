import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptApiProvider } from '../services/providers/TranscriptApiProvider';
import { TranscriptExtractor } from '../services/TranscriptExtractor';

// Mock Sentry
vi.mock('@sentry/cloudflare', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

function okResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

function apiBody(language: string, transcript: Array<{ text: string; start: number; duration: number }>) {
  return { video_id: 'dQw4w9WgXcQ', language, transcript };
}

describe('TranscriptApiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a successful manual-caption response (en) to TranscriptResult', async () => {
    try {
      (fetch as any).mockResolvedValue(okResponse(apiBody('en', [
        { text: 'Never gonna give you up', start: 0.5, duration: 2.1 },
        { text: 'Never gonna let you down', start: 2.6, duration: 1.9 },
      ])));
      const result = await new TranscriptApiProvider('key').fetch('dQw4w9WgXcQ');
      expect(result.videoId).toBe('dQw4w9WgXcQ');
      expect(result.language).toBe('en');
      expect(result.transcript).toBe('Never gonna give you up Never gonna let you down');
      expect(result.segments).toEqual([
        { text: 'Never gonna give you up', start: 0.5, duration: 2.1 },
        { text: 'Never gonna let you down', start: 2.6, duration: 1.9 },
      ]);
      // Request contract
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toBe('https://transcriptapi.com/api/v2/youtube/transcript?video_url=dQw4w9WgXcQ&format=json');
      expect(init.headers.Authorization).toBe('Bearer key');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('strips the asr- prefix from auto-generated language (asr-de → de)', async () => {
    try {
      (fetch as any).mockResolvedValue(okResponse(apiBody('asr-de', [
        { text: 'Hallo Welt', start: 0, duration: 1.5 },
      ])));
      const result = await new TranscriptApiProvider('key').fetch('dQw4w9WgXcQ');
      expect(result.language).toBe('de');
      expect(result.segments![0]!.text).toBe('Hallo Welt');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws (fallthrough) on provider failure statuses including 401/402/404/429', async () => {
    for (const status of [401, 402, 404, 429]) {
      (fetch as any).mockResolvedValue({ ok: false, status } as Response);
      try {
        await expect(new TranscriptApiProvider('key').fetch('dQw4w9WgXcQ')).rejects.toThrow(`TranscriptAPI fail: ${status}`);
      } finally {
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn());
      }
    }
  });

  it('throws (fallthrough) on malformed bodies', async () => {
    const cases: unknown[] = [
      null,
      {},
      { transcript: null },
      { transcript: 'not-an-array' },
      { transcript: [{ text: '', start: 0, duration: 1 }, { text: 'keep', start: -1, duration: 1 }] },
    ];
    for (const body of cases) {
      (fetch as any).mockResolvedValue(okResponse(body));
      try {
        await expect(new TranscriptApiProvider('key').fetch('dQw4w9WgXcQ')).rejects.toThrow();
      } finally {
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn());
      }
    }
  });

  it('throws (fallthrough) on timeout/network failure', async () => {
    (fetch as any).mockRejectedValue(new Error('The operation was aborted due to timeout'));
    try {
      await expect(new TranscriptApiProvider('key').fetch('dQw4w9WgXcQ')).rejects.toThrow(/aborted/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws when no API key is configured', async () => {
    try {
      await expect(new TranscriptApiProvider(undefined).fetch('dQw4w9WgXcQ')).rejects.toThrow(/not configured/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('TranscriptExtractor transcriptapi registration', () => {
  it('accepts transcriptapi in the provider order and makes transcriptapi the default first tier', () => {
    expect(TranscriptExtractor.parseProviderOrder('apify, transcriptapi, native')).toEqual(['apify', 'transcriptapi', 'native']);
    expect(TranscriptExtractor.parseProviderOrder()).toEqual(['transcriptapi', 'apify', 'decodo', 'native', 'supadata']);
  });

  it('builds a TranscriptApiProvider instance for the transcriptapi tier', () => {
    const extractor = new TranscriptExtractor(undefined, undefined, 'transcriptapi', undefined, 'tk');
    const built = (extractor as any).buildProviders() as Array<{ name: string; provider: unknown }>;
    expect(built).toHaveLength(1);
    expect(built[0]!.name).toBe('transcriptapi');
    expect(built[0]!.provider).toBeInstanceOf(TranscriptApiProvider);
  });
});