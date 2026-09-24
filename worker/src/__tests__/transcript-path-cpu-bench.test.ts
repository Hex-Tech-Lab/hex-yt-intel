/**
 * CPU bench for the transcript/metadata (pre-LLM) stages of /analyze-llm-stream.
 *
 * Purpose (2026-09-24): the 2026-09-23 Free-plan exceededCpu incident was
 * primarily BracketBuffer's O(n^2) rescan (see bracket-buffer-cpu-bench.test.ts),
 * but the route also spends CPU before the LLM call. This harness measures the
 * CPU-bound pure-parsing stages in isolation with realistic fixture sizes for a
 * ~28-minute video (the incident's shape), reporting wall ms per stage.
 *
 * Fixtures are synthesized (no network): page HTML ~800KB, timedtext JSON for a
 * ~28-min video (~4000 caption events), a chapter-dense description, a 5000-item
 * comment pool, and the resulting segments fed to ChunkGrouping. Measured on
 * warm Node/V8 -- Workers cold-isolate CPU is 10-100x slower per op, so treat
 * these numbers as relative shares, not absolute Workers CPU.
 */
import { describe, it, expect, vi } from 'vitest';
import { TranscriptExtractor } from '../services/TranscriptExtractor';
import { parseChapters } from '../services/chapter-parser';
import { groupSegmentsIntoChunks } from '../services/ChunkGrouping';
import { stratifiedSampleIndices, type StratifiableComment } from '../../../web/lib/services/comment-sampling';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('../services/http-utils', () => ({ fetchWithProxy: vi.fn() }));
vi.mock('../services/user-agent', () => ({ getRandomUserAgent: vi.fn(() => 'Mozilla/5.0') }));

const WORDS = [
  'the', 'narrative', 'pacing', 'audience', 'retention', 'creator', 'comment', 'signal',
  'shows', 'that', 'structured', 'follow', 'videos', 'because', 'early', 'hooks', 'determine',
  'whether', 'viewers', 'stay', 'engaged', 'across', 'formats', 'community',
];
function text(seed: number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(WORDS[(i * 7 + seed) % WORDS.length]!);
  return out.join(' ');
}

// ~28-min video, one caption event per ~0.4s of speech, ~8 words each.
const EVENT_COUNT = 4000;
function buildCaptionEvents() {
  const events: Array<{ segs: Array<{ utf8: string }>, tStartMs: number, dDurationMs: number }> = [];
  for (let i = 0; i < EVENT_COUNT; i++) {
    events.push({ segs: [{ utf8: ` ${text(i, 8)}` }], tStartMs: i * 420, dDurationMs: 400 });
  }
  return events;
}

// Realistic watch-page HTML: ~800KB of filler + ytInitialPlayerResponse with a
// captionTracks array (the regex target at TranscriptExtractor.ts:125).
function buildPageHtml(baseUrl: string): string {
  const filler = text(1, 90000); // ~650KB
  const tracks = JSON.stringify([{ baseUrl, langCode: 'en', kind: 'asr', name: 'English' }]);
  return `<!doctype html><html><body>${filler}</body><script>var ytInitialPlayerResponse={"captionTracks":${tracks},"videoDetails":{"title":"t"}};</script></html>`;
}

describe('Transcript/metadata path CPU bench (~28-min video, realistic fixtures)', () => {
  it('measures per-stage CPU (page-HTML parse, caption mapping, chapters, comments, chunking)', async () => {
    const events = buildCaptionEvents();
    const baseUrl = 'https://www.youtube.com/api/timedtext?lang=en&v=bench';
    const html = buildPageHtml(baseUrl);

    const { fetchWithProxy } = await import('../services/http-utils');
    (fetchWithProxy as any).mockImplementation(async (_url: string) => {
      if (_url.includes('timedtext')) {
        return { ok: true, json: async () => ({ events }) };
      }
      return { ok: true, text: async () => html };
    });

    // Stage 1+2: page-HTML fetch->regex->captionTracks JSON.parse, then
    // timedtext JSON parse + event->segment mapping (mocked network).
    const extractor = new TranscriptExtractor();
    const t0 = performance.now();
    const result = await (extractor as any).fetchFromPageHTML('bench_video_01');
    const pageHtmlMs = performance.now() - t0;

    // Stage 2 isolated (regex + JSON.parse over the HTML, no caption mapping):
    const t1 = performance.now();
    const captionMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])\s*,/);
    JSON.parse(captionMatch![1]!);
    const regexParseMs = performance.now() - t1;
    const mappingMs = pageHtmlMs - regexParseMs;

    // Stage 3: transcript string assembly (join + whitespace normalize).
    const t2 = performance.now();
    result.segments.map((s: { text: string }) => s.text).join(' ').replace(/\s+/g, ' ').trim();
    const transcriptJoinMs = performance.now() - t2;

    // Stage 4: chapter parsing of a chapter-dense description (50 chapters).
    let desc = text(3, 400) + '\n\n';
    for (let c = 0; c < 50; c++) {
      const mm = String(Math.floor((c * 30) / 60)).padStart(2, '0');
      const ss = String((c * 30) % 60).padStart(2, '0');
      desc += `${mm}:${ss} Chapter ${c + 1} — ${text(c, 6)}\n`;
    }
    const t3 = performance.now();
    const chapters = parseChapters(desc);
    const chaptersMs = performance.now() - t3;

    // Stage 5: stratified comment sampling over a 5000-comment pool.
    const pool: StratifiableComment[] = [];
    for (let i = 0; i < 5000; i++) {
      pool.push({ index: i, likeCount: (i * 37) % 900, publishedAt: new Date(1700000000000 - i * 60000).toISOString() });
    }
    const t4 = performance.now();
    const sampled = stratifiedSampleIndices(pool, 80, 8, 6);
    const samplingMs = performance.now() - t4;

    // Stage 6: ChunkGrouping over the extracted segments.
    const t5 = performance.now();
    const chunks = groupSegmentsIntoChunks(result.segments);
    const chunkingMs = performance.now() - t5;

    console.info(
      `[bench] pageHtml=${html.length}B events=${EVENT_COUNT} segments=${result.segments.length} ` +
        `pageHtmlMs=${pageHtmlMs.toFixed(1)} (regex+tracksParse=${regexParseMs.toFixed(1)}, captionMapping=${mappingMs.toFixed(1)}) ` +
        `transcriptJoinMs=${transcriptJoinMs.toFixed(1)} chaptersMs=${chaptersMs.toFixed(1)} (${chapters.length} chapters) ` +
        `samplingMs=${samplingMs.toFixed(1)} (${sampled.length} of ${pool.length}) chunkingMs=${chunkingMs.toFixed(1)} (${chunks.length} chunks)`,
    );

    expect(result.segments.length).toBeGreaterThan(3000);
    expect(chapters.length).toBe(50);
    expect(sampled.length).toBeGreaterThan(0);
    expect(chunks.length).toBeGreaterThan(0);
  }, 30000);
});
