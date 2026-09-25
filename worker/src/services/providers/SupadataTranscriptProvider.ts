/**
 * SupadataTranscriptProvider — Adapter implementing TranscriptProviderPort
 *
 * Backed by supadata.ai (GET /v1/transcript, header `x-api-key`). Added
 * 2026-09-25 as the LAST tier of the transcript chain: an AI-transcription
 * fallback for videos where every caption-based tier fails — including the
 * case where `native` affirmatively confirms zero caption tracks
 * (NoCaptionsConfirmedError), which the chain treats as a normal fall-through
 * (the flag only affects the final placeholder wording).
 *
 * API contract (verified against https://docs.supadata.ai OpenAPI v1.3.0):
 * - GET https://api.supadata.ai/v1/transcript?url=https://youtu.be/<id>&mode=native|generate
 *   → 200/202 { jobId } for async jobs (long videos), or
 *     { content: TranscriptChunk[] | string, lang, availableLangs }
 *   → 206 { error: 'transcript-unavailable' } when mode=native and the video
 *     has no existing captions (the trigger for the AI path). The 206 is
 *     documented on the CURRENT /v1/transcript spec (docs.supadata.ai
 *     OpenAPI v1.3.0, response '206 Transcript Unavailable' — re-verified
 *     2026-09-25 against the live endpoint too: captioned video returns
 *     200 { lang, availableLangs, content:[{text, offset(ms), duration(ms)}] });
 *     a 200 body carrying error 'transcript-unavailable' is treated the same
 *     defensively (the shared Error schema exposes the code in-body).
 * - Poll GET https://api.supadata.ai/v1/transcript/<jobId> →
 *     { status: queued|active|completed|failed, content?, lang? }.
 * - TranscriptChunk: { text, offset (ms), duration (ms), lang } — offsets are
 *   mapped ms→s into the shared TranscriptSegment shape.
 *
 * Mode choice (review 2026-09-25): native→generate, NOT mode=auto. `auto`
 * lets Supadata itself decide to start AI generation with no cap check on
 * our side, so the SUPADATA_MAX_AI_MINUTES cap would be unenforceable.
 * Keeping the two calls separate lets us enforce the cap between them.
 *
 * Cost control: captioned (native) costs 1 credit; AI mode costs 2
 * credits/minute of video. SUPADATA_MAX_AI_MINUTES (default 60) caps AI
 * mode. FAIL CLOSED (review 2026-09-25): generate runs ONLY when the video
 * duration is known (finite, > 0) and within the cap — an unknown duration
 * never reaches generate. Note the native attempt itself may consume 1
 * credit even when generate is then disallowed; that probe is kept because
 * the native result is useful on its own (captioned videos cost 1 credit
 * total).
 *
 * 401/402/403/429/5xx and any malformed body are provider failures: they
 * throw so the chain falls through to the placeholder.
 */

import type { TranscriptProviderPort, TranscriptResult } from '../../ports/TranscriptProviderPort';

const BASE_URL = 'https://api.supadata.ai/v1/transcript';

interface SupadataChunk {
  text?: string;
  offset?: number;
  duration?: number;
}

interface SupadataTranscriptBody {
  content?: SupadataChunk[] | string;
  lang?: string;
}

interface SupadataJobBody {
  jobId?: string;
}

interface SupadataJobStatusBody {
  status?: 'queued' | 'active' | 'completed' | 'failed';
  error?: { message?: string; details?: string } | null;
  content?: SupadataChunk[] | string;
  lang?: string;
}

type SupadataFirstResponse = SupadataTranscriptBody | SupadataJobBody;

export class SupadataTranscriptProvider implements TranscriptProviderPort {
  private apiKey?: string;
  private maxAiMinutes: number;
  private pollIntervalMs: number;

  constructor(apiKey?: string, maxAiMinutes = 60, pollIntervalMs = 5000) {
    this.apiKey = apiKey;
    this.maxAiMinutes = maxAiMinutes;
    this.pollIntervalMs = pollIntervalMs;
  }

  async fetch(videoId: string, durationSeconds?: number): Promise<TranscriptResult> {
    if (!this.apiKey) throw new Error('Supadata key not configured');

    // mode=native (1 credit): cheap captioned attempt first. It doubles as the
    // "does an existing transcript exist" probe: only its 206
    // transcript-unavailable / failure reaches the AI path below.
    const native = await this.requestTranscript(videoId, 'native');
    if (native) return native;

    if (this.maxAiMinutes <= 0) {
      throw new Error(`Supadata AI mode skipped: SUPADATA_MAX_AI_MINUTES cap is ${this.maxAiMinutes}min (AI generation disabled)`);
    }
    if (!this.durationWithinCap(durationSeconds)) {
      throw new Error(
        `Supadata AI mode skipped: ${durationSeconds != null && Number.isFinite(durationSeconds) ? `video duration ${Math.round(durationSeconds / 60)}min exceeds` : 'video duration unknown (fail-closed against an unbounded metered job)'} ${this.maxAiMinutes}min cap`,
      );
    }

    // mode=generate (2 credits/minute): always-AI transcription.
    const generated = await this.requestTranscript(videoId, 'generate');
    if (generated) return generated;
    throw new Error('Supadata returned no transcript in either native or generate mode');
  }

  /**
   * AI generate is allowed ONLY when the video duration is known (finite,
   * > 0) and within the cap. Fail-closed on an unknown duration: an
   * unbounded 2-credits/minute AI job is never started blind (review P1,
   * 2026-09-25).
   */
  private durationWithinCap(durationSeconds?: number): boolean {
    if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
    return durationSeconds / 60 <= this.maxAiMinutes;
  }

  /**
   * One mode attempt: initial request (+ job polling when a jobId comes back).
   * Returns null only when the source affirmatively has no native transcript
   * (206 transcript-unavailable) so the caller can consider the AI path.
   */
  private async requestTranscript(videoId: string, mode: 'native' | 'generate'): Promise<TranscriptResult | null> {
    const startedAt = Date.now();
    const first = await this.callApi(`${BASE_URL}?url=${encodeURIComponent(`https://youtu.be/${videoId}`)}&mode=${mode}`);
    if (first === null) return null;

    if ('jobId' in first && first.jobId) {
      const polled = await this.pollJob(first.jobId, startedAt);
      return polled === null ? null : this.toResult(videoId, polled);
    }
    return this.toResult(videoId, first as SupadataTranscriptBody);
  }

  /**
   * GET /transcript?... Returns the parsed body, or null on 206
   * transcript-unavailable. Any other non-ok (401/402/403/404/429/5xx) throws
   * so the chain falls through.
   */
  private async callApi(url: string): Promise<SupadataFirstResponse | null> {
    const response = await this.request(url, 30000);
    if (response.status === 206) return null;
    if (!response.ok) throw new Error(`Supadata fail: ${response.status}`);
    const body = response.payload as SupadataFirstResponse;
    if (!body || typeof body !== 'object') throw new Error('Supadata returned malformed body');
    // Defensive: the documented transcript-unavailable signal is a 206, but the
    // shared Error schema carries `error: 'transcript-unavailable'` in-body —
    // treat an ok response with that code the same so a Supadata-side envelope
    // change can never flip "no native transcript" into "malformed failure".
    if ((body as { error?: string }).error === 'transcript-unavailable') return null;
    return body;
  }

  /**
   * Authenticated GET with a per-call timeout. The timeout is implemented with
   * a setTimeout-driven abort (not AbortSignal.timeout) so it stays
   * fake-timer-testable and can be capped to the caller's remaining polling
   * budget. The body is buffered inside the try so the controller can be
   * released in finally (same pattern as TranscriptApiProvider).
   */
  private async request(url: string, timeoutMs: number): Promise<{ status: number; ok: boolean; payload: unknown }> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error('Supadata API key not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { 'x-api-key': apiKey },
        signal: controller.signal,
      });
      // Only a 200/202 carries a JSON body we use; 206 and failures are decided by status.
      const payload: unknown = response.ok && response.status !== 206 ? await response.json() : null;
      return { status: response.status, ok: response.ok, payload };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  /** Poll a 202/200 jobId until completed/failed or the 60s job deadline.
   * Each sleep AND each poll request are capped to the remaining time so the
   * loop can never overrun its own deadline (review P2, 2026-09-25). */
  private async pollJob(jobId: string, startedAt: number): Promise<SupadataTranscriptBody | null> {
    const deadline = startedAt + 60000;
    for (;;) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error(`Supadata job ${jobId} did not complete within the 60s polling deadline`);
      await new Promise(resolve => setTimeout(resolve, Math.min(this.pollIntervalMs, remainingMs)));
      const remainingAfterSleep = deadline - Date.now();
      if (remainingAfterSleep <= 0) throw new Error(`Supadata job ${jobId} did not complete within the 60s polling deadline`);
      const url = `${BASE_URL}/${encodeURIComponent(jobId)}`;
      const response = await this.request(url, Math.min(30000, remainingAfterSleep));
      if (!response.ok) throw new Error(`Supadata job poll fail: ${response.status}`);
      const body = response.payload as SupadataJobStatusBody;
      if (!body || typeof body !== 'object') throw new Error('Supadata returned malformed job body');
      if (body.status === 'failed') throw new Error(`Supadata job failed: ${body.error?.message ?? body.error?.details ?? 'unknown error'}`);
      if (body.status === 'completed') return { content: body.content, lang: body.lang };
      // queued/active → keep polling until the deadline
    }
  }

  /** Maps a Supadata transcript body to TranscriptResult (ms → s offsets). */
  private toResult(videoId: string, body: SupadataTranscriptBody): TranscriptResult {
    const language = body.lang || 'en';

    if (typeof body.content === 'string') {
      const transcript = body.content.replace(/\s+/g, ' ').trim();
      if (!transcript) throw new Error('Supadata transcript was empty');
      return { videoId, transcript, language };
    }

    if (!Array.isArray(body.content)) throw new Error('Supadata returned malformed body');

    const segments = (body.content as SupadataChunk[])
      .map(c => ({
        text: (c.text ?? '').replace(/\s+/g, ' ').trim(),
        // Number.isFinite, not typeof: an external Infinity/NaN offset would
        // pass a typeof check and poison the segment list (review P3, 2026-09-25).
        start: Number.isFinite(c.offset) ? (c.offset as number) / 1000 : NaN,
        duration: Number.isFinite(c.duration) ? (c.duration as number) / 1000 : NaN,
      }))
      .filter(s => s.text.length > 0 && !isNaN(s.start) && !isNaN(s.duration) && s.start >= 0 && s.duration > 0 && s.start < 86400);

    if (segments.length === 0) throw new Error('Supadata transcript had no valid segments');

    const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!transcript) throw new Error('Empty transcript after processing');

    return { videoId, transcript, language, segments };
  }
}
