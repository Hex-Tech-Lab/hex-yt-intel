import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SupadataTranscriptProvider } from '../services/providers/SupadataTranscriptProvider';
import { TranscriptExtractor, parseSupadataMaxAiMinutes, parseVideoDurationSeconds } from '../services/TranscriptExtractor';
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
    try {
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
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('plain-text string content (text=true style) is accepted without segments', async () => {
    try {
      (fetch as any).mockResolvedValue(okResponse({ lang: 'de', availableLangs: ['de'], content: 'Hallo Welt zusammen.' }));
      const result = await new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ');
      expect(result.transcript).toBe('Hallo Welt zusammen.');
      expect(result.language).toBe('de');
      expect(result.segments).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('202 job flow: jobId from the initial call is polled to completion', async () => {
    try {
      (fetch as any)
        .mockResolvedValueOnce(okResponse({ jobId: 'job-123' })) // native → async job
        .mockResolvedValueOnce(okResponse({ status: 'queued' }))
        .mockResolvedValueOnce(okResponse({ status: 'active' }))
        .mockResolvedValueOnce(okResponse({ status: 'completed', ...transcriptBody('en') }));
      const result = await new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ');
      expect(result.transcript).toBe('Never gonna give you up Never gonna let you down');
      expect((fetch as any).mock.calls).toHaveLength(4);
      expect((fetch as any).mock.calls[1][0]).toBe('https://api.supadata.ai/v1/transcript/job-123');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('AI mode: native 206 (no captions) → mode=generate runs when duration is within the cap', async () => {
    try {
      (fetch as any)
        .mockResolvedValueOnce({ ok: true, status: 206, json: () => Promise.resolve({ error: 'transcript-unavailable' }) } as Response)
        .mockResolvedValueOnce(okResponse({ ...transcriptBody('en'), lang: 'en' }));
      const result = await new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ', 3000);
      expect(result.transcript).toBe('Never gonna give you up Never gonna let you down');
      expect((fetch as any).mock.calls[1][0]).toBe(URL_GENERATE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('AI mode skipped over cap: known duration above SUPADATA_MAX_AI_MINUTES → no generate call', async () => {
    try {
      (fetch as any).mockResolvedValueOnce({ ok: true, status: 206, json: () => Promise.resolve({ error: 'transcript-unavailable' }) } as Response);
      await expect(new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ', 90 * 60)).rejects.toThrow(/AI mode skipped/);
      expect((fetch as any).mock.calls).toHaveLength(1);
      expect((fetch as any).mock.calls[0][0]).toBe(URL_NATIVE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('AI mode skipped when the cap is 0 (disabled)', async () => {
    try {
      (fetch as any).mockResolvedValueOnce({ ok: true, status: 206, json: () => Promise.resolve({ error: 'transcript-unavailable' }) } as Response);
      await expect(new SupadataTranscriptProvider('key', 0, POLL).fetch('dQw4w9WgXcQ')).rejects.toThrow(/AI mode skipped/);
      expect((fetch as any).mock.calls).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws (fallthrough) on provider failure statuses 401/402/403/429/500', async () => {
    try {
      for (const status of [401, 402, 403, 429, 500]) {
        (fetch as any).mockResolvedValue({ ok: false, status } as Response);
        try {
          await expect(new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ')).rejects.toThrow(`Supadata fail: ${status}`);
        } finally {
          vi.unstubAllGlobals();
          vi.stubGlobal('fetch', vi.fn());
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws (fallthrough) on malformed bodies', async () => {
    try {
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
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws when a polled job reports failed status', async () => {
    try {
      (fetch as any)
        .mockResolvedValueOnce(okResponse({ jobId: 'job-fail' }))
        .mockResolvedValueOnce(okResponse({ status: 'failed', error: { message: 'video too long' } }));
      await expect(new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ')).rejects.toThrow(/Supadata job failed: video too long/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('AI mode fail-closed: UNKNOWN duration → native attempted, generate never called', async () => {
    try {
      (fetch as any).mockResolvedValueOnce({ ok: true, status: 206, json: () => Promise.resolve({ error: 'transcript-unavailable' }) } as Response);
      await expect(new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ')).rejects.toThrow(/AI mode skipped/);
      expect((fetch as any).mock.calls).toHaveLength(1);
      expect((fetch as any).mock.calls[0][0]).toBe(URL_NATIVE);
      expect((fetch as any).mock.calls.some((c: unknown[]) => String(c[0]).includes('mode=generate'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('AI mode fail-closed: non-finite (Infinity) duration → generate never called', async () => {
    try {
      (fetch as any).mockResolvedValueOnce({ ok: true, status: 206, json: () => Promise.resolve({ error: 'transcript-unavailable' }) } as Response);
      await expect(new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ', Number.POSITIVE_INFINITY)).rejects.toThrow(/AI mode skipped/);
      expect((fetch as any).mock.calls).toHaveLength(1);
      expect((fetch as any).mock.calls[0][0]).toBe(URL_NATIVE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('in-body transcript-unavailable error code (defensive) also triggers the AI path', async () => {
    try {
      (fetch as any)
        .mockResolvedValueOnce(okResponse({ error: 'transcript-unavailable', message: 'no transcript' }))
        .mockResolvedValueOnce(okResponse({ ...transcriptBody('en'), lang: 'en' }));
      const result = await new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ', 3000);
      expect(result.transcript).toBe('Never gonna give you up Never gonna let you down');
      expect((fetch as any).mock.calls[1][0]).toBe(URL_GENERATE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Infinity offsets/durations are filtered by Number.isFinite, valid segments kept', async () => {
    try {
      (fetch as any).mockResolvedValue(okResponse({
        lang: 'en',
        availableLangs: ['en'],
        content: [
          { text: 'bad infinite', offset: Number.POSITIVE_INFINITY, duration: 1000 },
          { text: 'bad infinite duration', offset: 1000, duration: Number.POSITIVE_INFINITY },
          { text: 'good one', offset: 1500, duration: 1200 },
        ],
      }));
      const result = await new SupadataTranscriptProvider('key', 60, POLL).fetch('dQw4w9WgXcQ');
      expect(result.segments).toEqual([{ text: 'good one', start: 1.5, duration: 1.2 }]);
      expect(result.transcript).toBe('good one');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('polling cannot overrun its 60s job deadline: sleeps and request timeouts are capped to remaining time', async () => {
    vi.useFakeTimers();
    try {
      let call = 0;
      (fetch as any).mockImplementation(async (_url: string, init?: { signal?: AbortSignal }) => {
        call += 1;
        if (call === 1) return okResponse({ jobId: 'job-slow' });
        // Completed poll cycles consume 10s each (simulated server latency);
        // the 4th poll hangs until the caller's capped abort fires.
        if (call <= 4) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          return okResponse({ status: 'queued' });
        }
        // 4th poll hangs until the caller's capped abort fires, then the
        // (aborted-but-resolved) poll returns queued again and the loop's
        // next deadline check ends it.
        return new Promise<Response>(resolve => {
          init?.signal?.addEventListener('abort', () => resolve(okResponse({ status: 'queued' })));
        });
      });
      const t0 = Date.now();
      const attempt = new SupadataTranscriptProvider('key', 60, 5000).fetch('dQw4w9WgXcQ', 3000);
      // Attach the rejection handler BEFORE running timers so the provider's
      // deadline rejection is never momentarily unhandled.
      const settled = attempt.then(value => ({ resolved: value }), e => ({ error: e }));
      await vi.runAllTimersAsync();
      const outcome = await settled;
      expect((outcome as { resolved?: unknown }).resolved).toBeUndefined();
      expect((outcome as { error?: { message: string } }).error?.message).toMatch(/did not complete within the 60s polling deadline/);
      // Without the remaining-time cap the hang-abort would fire at 30s after
      // t≈50s → 80s total; with it, the deadline (60s) is respected.
      expect(Date.now() - t0).toBeLessThanOrEqual(60500);
      expect(call).toBeGreaterThanOrEqual(5);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('throws when no API key is configured', async () => {
    try {
      await expect(new SupadataTranscriptProvider(undefined, 60, POLL).fetch('dQw4w9WgXcQ')).rejects.toThrow(/not configured/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Negative control (review P2, 2026-09-26): the 60s poll window must start
  // at jobId RECEIPT, not before the submit call. Submit takes 25s (inside
  // the initial call's real 30s timeout); a queued poll at t=31s, then a
  // final poll whose server latency is 29.5s (inside the 30s per-request
  // cap) completes at t≈60.5s — past the old startedAt-anchored deadline of
  // t=60 (last poll aborted → loop throws) but 24.5s inside the
  // jobId-anchored window (25s + 60s = 85s). Polls honor the caller's abort
  // signal — an abort-ignoring mock would make the remaining-time cap
  // decorative and this control meaningless.
  it('submit latency does not eat the poll window (deadline starts at jobId receipt)', async () => {
    vi.useFakeTimers();
    try {
      let call = 0;
      (fetch as any).mockImplementation(async (_url: string, init?: { signal?: AbortSignal }) => {
        call += 1;
        if (call === 1) {
          await new Promise(resolve => setTimeout(resolve, 25000)); // slow submit (inside the 30s request cap)
          return okResponse({ jobId: 'job-slow-submit' });
        }
        if (call === 2) {
          await new Promise(resolve => setTimeout(resolve, 6000));
          return okResponse({ status: 'queued' });
        }
        // Final poll: 29.5s server latency (inside the 30s per-request cap);
        // resolves 'queued' (not completed) when aborted, mirroring what a
        // real aborted fetch leaves behind.
        return new Promise<Response>(resolve => {
          const completedTimer = setTimeout(() => resolve(okResponse({ status: 'completed', ...transcriptBody('en') })), 29500);
          init?.signal?.addEventListener('abort', () => { clearTimeout(completedTimer); resolve(okResponse({ status: 'queued' })); });
        });
      });
      const attempt = new SupadataTranscriptProvider('key', 60, 1).fetch('dQw4w9WgXcQ', 3000);
      const settled = attempt.then(value => ({ resolved: value }), e => ({ error: e }));
      await vi.runAllTimersAsync();
      const outcome = await settled;
      expect((outcome as { error?: { message: string } }).error).toBeUndefined();
      expect((outcome as { resolved?: { transcript: string } }).resolved?.transcript).toBe('Never gonna give you up Never gonna let you down');
      expect(call).toBe(3);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
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
    try {
      const extractor = new TranscriptExtractor(undefined, undefined, 'native,supadata', undefined, undefined, undefined, 'sd-key', 60);
      (extractor as any).buildProviders = () => [
        { name: 'native', provider: { fetch: vi.fn().mockRejectedValue(new NoCaptionsConfirmedError('no caption tracks')) } },
        { name: 'supadata', provider: { fetch: vi.fn().mockResolvedValue({ videoId: 'VALID_ID_12', transcript: 'AI generated text', language: 'en' }) } },
      ];
      const result = await extractor.fetch('VALID_ID_12');
      expect(result.transcript).toBe('AI generated text');
      expect(result.confirmedNoCaptions).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const URL_NATIVE_12 = 'https://api.supadata.ai/v1/transcript?url=https%3A%2F%2Fyoutu.be%2FVALID_ID_12&mode=native';

describe('Supadata cap enforcement on the chain path (review P1, 2026-09-25)', () => {  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Route-equivalent: the extractor is what analysis.ts calls; for over-cap
  // AND unknown durations the provider's native call happens at most once
  // and NO mode=generate request is ever sent (chain falls through to the
  // placeholder instead of starting a metered AI job).
  it.each([
    ['over-cap duration', 90 * 60],
    ['unknown duration', undefined],
    ['non-finite duration', Number.POSITIVE_INFINITY],
  ])('%s → mode=generate never requested on the chain', async (_label, duration) => {
    try {
      const fetchMock = vi.fn()
        .mockResolvedValue({ ok: true, status: 206, json: () => Promise.resolve({ error: 'transcript-unavailable' }) } as Response);
      vi.stubGlobal('fetch', fetchMock);
      const extractor = new TranscriptExtractor(undefined, undefined, 'supadata', undefined, undefined, undefined, 'sd-key', 60);
      const result = await extractor.fetch('VALID_ID_12', duration as number | undefined);
      const urls = fetchMock.mock.calls.map(c => String(c[0]));
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe(URL_NATIVE_12);
      expect(urls.some(u => u.includes('mode=generate'))).toBe(false);
      // Chain falls through to the placeholder — no metered AI job.
      expect(result.transcript).toBe('[Transcript unavailable for this video - content ingestion failed across all available sources]');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('SUPADATA_MAX_AI_MINUTES=0 (explicit disable) survives parsing and reaches the provider', async () => {
    expect(parseSupadataMaxAiMinutes('0')).toBe(0);
    const extractor = new TranscriptExtractor(undefined, undefined, 'supadata', undefined, undefined, undefined, 'sd-key', parseSupadataMaxAiMinutes('0'));
    const built = (extractor as any).buildProviders() as Array<{ name: string; provider: SupadataTranscriptProvider }>;
    expect((built[0]!.provider as any).maxAiMinutes).toBe(0);
    // And it disables AI on the chain even for an in-cap duration.
    const fetchMock = vi.fn()
      .mockResolvedValue({ ok: true, status: 206, json: () => Promise.resolve({ error: 'transcript-unavailable' }) } as Response);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await extractor.fetch('VALID_ID_12', 3000);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([URL_NATIVE_12]);
  });

  it('parseSupadataMaxAiMinutes contract: explicit 0 preserved, missing/invalid → default path (undefined)', () => {
    expect(parseSupadataMaxAiMinutes('30')).toBe(30);
    expect(parseSupadataMaxAiMinutes('0')).toBe(0);
    expect(parseSupadataMaxAiMinutes(undefined)).toBeUndefined();
    expect(parseSupadataMaxAiMinutes('')).toBeUndefined();
    expect(parseSupadataMaxAiMinutes('   ')).toBeUndefined();
    expect(parseSupadataMaxAiMinutes('abc')).toBeUndefined();
    expect(parseSupadataMaxAiMinutes('-5')).toBeUndefined();
    expect(parseSupadataMaxAiMinutes('Infinity')).toBeUndefined();
  });

  it('parseVideoDurationSeconds contract: finite positive numbers only', () => {
    expect(parseVideoDurationSeconds(3000)).toBe(3000);
    expect(parseVideoDurationSeconds('90.5')).toBe(90.5);
    expect(parseVideoDurationSeconds(0)).toBeUndefined();
    expect(parseVideoDurationSeconds(-5)).toBeUndefined();
    expect(parseVideoDurationSeconds(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(parseVideoDurationSeconds(Number.NaN)).toBeUndefined();
    expect(parseVideoDurationSeconds(undefined)).toBeUndefined();
    expect(parseVideoDurationSeconds(null)).toBeUndefined();
    expect(parseVideoDurationSeconds('abc')).toBeUndefined();
  });

  it('duration flows through the chain to the provider', async () => {
    const extractor = new TranscriptExtractor(undefined, undefined, 'supadata', undefined, undefined, undefined, 'sd-key', 60);
    let received: number | undefined;
    (extractor as any).buildProviders = () => [
      { name: 'supadata', provider: { fetch: (_vid: string, durationSeconds?: number) => { received = durationSeconds; return Promise.resolve({ videoId: 'VALID_ID_12', transcript: 'ok', language: 'en' }); } } },
    ];
    try {
      await extractor.fetch('VALID_ID_12', 1234);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(received).toBe(1234);
  });
});
