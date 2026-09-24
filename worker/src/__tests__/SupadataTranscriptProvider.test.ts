import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SupadataTranscriptProvider } from '../services/providers/SupadataTranscriptProvider';
import { TranscriptExtractor } from '../services/TranscriptExtractor';
import { NoCaptionsConfirmedError } from '../ports/TranscriptProviderPort';

vi.mock('@sentry/cloudflare', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

const POLL = 1; // fast poll interval for tests

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

function transcriptBody(lang = 'en') {
  return {
    lang,
    availableLangs: [lang],
    content: [
      { text: 'Never gonna give you up', offset: 1500, duration: 1200 },
      { text: 'Never gonna let you down', offset: 2700, duration: 1900 },
    ],
  };
}

const URL_NATIVE = 'https://api.supadata.ai/v1/transcript?url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ&mode=native';
const URL_GENERATE = 'https://api.supadata.ai/v1/transcript?url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ&mode=generate';

describe('SupadataTranscriptProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captioned success: mode=native 200 with chunk array maps ms→s into segments', async () => {
    (fetch as any).mockResolvedValue(okResponse(transcriptBody('en')));
    const result = await new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ');
    expect(result.videoId).toBe('dQw4w9WgXcQ');
    expect(result.language).toBe('en');
    expect(result.transcript).toBe('Never gonna give you up Never gonna let you down');
    expect(result.segments).toEqual([
      { text: 'Never gonna give you up', start: 1.5, duration: 1.2 },
      { text: 'Never gonna let you down', start: 2.7, duration: 1.9 },
    ]);
    // Request contract: single native call, no generate
    expect((fetch as any).mock.calls).toHaveLength(1);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe(URL_NATIVE);
    expect(init.headers['x-api-key']).toBe('key');
  });

  it('plain-text string content (text=true style) is accepted without segments', async () => {
    (fetch as any).mockResolvedValue(okResponse({ lang: 'de', availableLangs: ['de'], content: 'Hallo Welt zusammen.' }));
    const result = await new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ');
    expect(result.transcript).toBe('Hallo Welt zusammen.');
    expect(result.language).toBe('de');
    expect(result.segments).toBeUndefined();
  });

  it('202 job flow: jobId from the initial call is polled to completion', async () => {
    (fetch as any)
      .mockResolvedValueOnce(okResponse({ jobId: 'job-123' })) // native → async job
      .mockResolvedValueOnce(okResponse({ status: 'queued' }))
      .mockResolvedValueOnce(okResponse({ status: 'active' }))
      .mockResolvedValueOnce(okResponse({ status: 'completed', ...transcriptBody('en') }));
    const result = await new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ');
    expect(result.transcript).toBe('Never gonna give you up Never gonna let you down');
    expect((fetch as any).mock.calls).toHaveLength(4);
    expect((fetch as any).mock.calls[1][0]).toBe('https://api.supadata.ai/v1/transcript/job-123');
  });

  it('AI mode: native 206 (no captions) → mode=generate runs when duration is within the cap', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 206, json: () => Promise.resolve({ error: 'transcript-unavailable' }) } as Response)
      .mockResolvedValueOnce(okResponse({ ...transcriptBody('en'), lang: 'en' }));
    const result = await new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ', 3000);
    expect(result.transcript).toBe('Never gonna give you up Never gonna let you down');
    expect((fetch as any).mock.calls[1][0]).toBe(URL_GENERATE);
  });

  it('AI mode skipped over cap: known duration above SUPADATA_MAX_AI_MINUTES → no generate call', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, status: 206, json: () => Promise.resolve({ error: 'transcript-unavailable' }) } as Response);
    await expect(new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ', 90 * 60)).rejects.toThrow(/AI mode skipped/);
    expect((fetch as any).mock.calls).toHaveLength(1);
    expect((fetch as any).mock.calls[0][0]).toBe(URL_NATIVE);
  });

  it('AI mode skipped when the cap is 0 (disabled)', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: true, status: 206, json: () => Promise.resolve({ error: 'transcript-unavailable' }) } as Response);
    await expect(new SupadataTranscriptProvider('key', 0, POLL).fetch('dQw4w9WgXcQ')).rejects.toThrow(/AI mode skipped/);
    expect((fetch as any).mock.calls).toHaveLength(1);
  });

  it('throws (fallthrough) on provider failure statuses 401/402/403/429/500', async () => {
    for (const status of [401, 402, 403, 429, 500]) {
      (fetch as any).mockResolvedValue({ ok: false, status } as Response);
      try {
        await expect(new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ')).rejects.toThrow(`Supadata fail: ${status}`);
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
      { content: null },
      { content: 42 },
      { content: [{ text: '', offset: 0, duration: 1 }, { text: 'keep', offset: -1, duration: 1 }] },
      { content: [{ text: 'keep', offset: '0', duration: 1 }] },
    ];
    for (const body of cases) {
      (fetch as any).mockResolvedValue(okResponse(body));
      try {
        await expect(new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ')).rejects.toThrow();
      } finally {
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn());
      }
    }
  });

  it('throws when a polled job reports failed status', async () => {
    (fetch as any)
      .mockResolvedValueOnce(okResponse({ jobId: 'job-fail' }))
      .mockResolvedValueOnce(okResponse({ status: 'failed', error: { message: 'video too long' } }));
    await expect(new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ')).rejects.toThrow(/Supadata job failed: video too long/);
  });

  it('throws when no API key is configured', async () => {
    await expect(new SupadataTranscriptProvider(undefined, 60, POLL).fetch('dQw4w9WgXcQ')).rejects.toThrow(/not configured/);
  });
});

describe('SupadataTranscriptProvider chain registration', () => {
  it('supadata is a valid provider name and is the default LAST tier', () => {
    expect(TranscriptExtractor.parseProviderOrder('supadata,native')).toEqual(['supadata', 'native']);
    expect(TranscriptExtractor.parseProviderOrder()).toEqual(['transcriptapi', 'apify', 'decodo', 'native', 'supadata']);
  });

  it('builds a SupadataTranscriptProvider for the supadata tier with the AI cap wired through', () => {
    const extractor = new TranscriptExtractor(undefined, undefined, 'supadata', undefined, undefined, undefined, 'sd-key', 90);
    const built = (extractor as any).buildProviders() as Array<{ name: string; provider: SupadataTranscriptProvider }>;
    expect(built).toHaveLength(1);
    expect(built[0]!.name).toBe('supadata');
    const provider = built[0]!.provider;
    expect(provider).toBeInstanceOf(SupadataTranscriptProvider);
    expect((provider as any).maxAiMinutes).toBe(90);
  });

  it('runs after native throws NoCaptionsConfirmedError — confirmed-no-captions does not stop the chain', async () => {
    const extractor = new TranscriptExtractor(undefined, undefined, 'native,supadata', undefined, undefined, undefined, 'sd-key', 60);
    (extractor as any).buildProviders = () => [
      { name: 'native', provider: { fetch: vi.fn().mockRejectedValue(new NoCaptionsConfirmedError('no caption tracks')) } },
      { name: 'supadata', provider: { fetch: vi.fn().mockResolvedValue({ videoId: 'VALID_ID_12', transcript: 'AI generated text', language: 'en' }) } },
    ];
    const result = await extractor.fetch('VALID_ID_12');
    expect(result.transcript).toBe('AI generated text');
    expect(result.confirmedNoCaptions).toBeUndefined();
  });
});
