import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApifyTranscriptProvider, APIFY_LANGUAGE_PREFERENCE } from '../services/providers/ApifyTranscriptProvider';
import { TranscriptExtractor } from '../services/TranscriptExtractor';

// Mock Sentry
vi.mock('@sentry/cloudflare', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, './fixtures/apify-transcript-dQw4w9WgXcQ.json'), 'utf-8'),
) as unknown[];

function okResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

describe('ApifyTranscriptProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a successful dataset item to TranscriptResult (fixture)', async () => {
    try {
      (fetch as any).mockResolvedValue(okResponse(fixture));
      const result = await new ApifyTranscriptProvider('token').fetch('dQw4w9WgXcQ');
      expect(result.videoId).toBe('dQw4w9WgXcQ');
      expect(result.transcript.length).toBeGreaterThan(100);
      expect(result.segments!.length).toBeGreaterThan(50);
      expect(result.language).toBeTruthy();
      // Segments are in seconds, same unit the chain already uses
      const first = result.segments![0]!;
      expect(first.start).toBeGreaterThanOrEqual(0);
      expect(first.duration).toBeGreaterThan(0);
      expect(first.text.length).toBeGreaterThan(0);
      // Request contract
      const [url, init] = (fetch as any).mock.calls[0];
      expect(url).toContain('run-sync-get-dataset-items?timeout=120&maxTotalChargeUsd=0.05');
      const body = JSON.parse(init.body);
      expect(body.youtube_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(body.languages).toEqual([...APIFY_LANGUAGE_PREFERENCE]);
      expect(body.languages[0]).toBe('en');
      expect(body.languages[1]).toBe('ar');
      expect(body.languages.length).toBeGreaterThanOrEqual(65);
      expect(init.headers.Authorization).toBe('Bearer token');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws (fallthrough) on success:false', async () => {
    (fetch as any).mockResolvedValue(okResponse([{ success: false, error_message: 'No captions found' }]));
    try {
      await expect(new ApifyTranscriptProvider('token').fetch('dQw4w9WgXcQ')).rejects.toThrow(/Apify actor reported failure/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws (fallthrough) on empty timestamped list', async () => {
    (fetch as any).mockResolvedValue(okResponse([{ success: true, language_code: 'en', timestamped: [] }]));
    try {
      await expect(new ApifyTranscriptProvider('token').fetch('dQw4w9WgXcQ')).rejects.toThrow(/empty timestamped/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws (fallthrough) on HTTP non-2xx', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 500 } as Response);
    try {
      await expect(new ApifyTranscriptProvider('token').fetch('dQw4w9WgXcQ')).rejects.toThrow('Apify fail: 500');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws (fallthrough) on timeout', async () => {
    (fetch as any).mockRejectedValue(new Error('The operation was aborted due to timeout'));
    try {
      await expect(new ApifyTranscriptProvider('token').fetch('dQw4w9WgXcQ')).rejects.toThrow(/aborted/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws when no API token is configured', async () => {
    try {
      await expect(new ApifyTranscriptProvider(undefined).fetch('dQw4w9WgXcQ')).rejects.toThrow(/not configured/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('TranscriptExtractor provider order parsing', () => {
  it('parses a comma list, trims, lowercases and dedupes', () => {
    expect(TranscriptExtractor.parseProviderOrder(' native, decodo ,native,APIFY')).toEqual(['native', 'decodo', 'apify']);
  });

  it('falls back to the default order for empty or all-invalid lists', () => {
    expect(TranscriptExtractor.parseProviderOrder()).toEqual(['transcriptapi', 'apify', 'decodo', 'native']);
    expect(TranscriptExtractor.parseProviderOrder('  ')).toEqual(['transcriptapi', 'apify', 'decodo', 'native']);
    expect(TranscriptExtractor.parseProviderOrder('bogus,na')).toEqual(['transcriptapi', 'apify', 'decodo', 'native']);
  });

  it('chain falls through apify→decodo→native→placeholder and aggregates tier failures', async () => {
    vi.stubGlobal('fetch', vi.fn()); // apify uses raw fetch
    try {
      const extractor = new TranscriptExtractor(undefined, 'decodo-key', 'apify,decodo,native', 'apify-token');
      (extractor as any).buildProviders = () => [
        { name: 'apify', provider: { fetch: vi.fn().mockRejectedValue(new Error('Apify fail')) } },
        { name: 'decodo', provider: { fetch: vi.fn().mockRejectedValue(new Error('Decodo fail')) } },
        { name: 'native', provider: { fetch: vi.fn().mockRejectedValue(new Error('Native fail')) } },
      ];
      const result = await extractor.fetch('dQw4w9WgXcQ');
      expect(result.confirmedNoCaptions).toBe(false);
      expect(result.transcript).toContain('Transcript unavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
