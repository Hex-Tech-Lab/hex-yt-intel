import * as Sentry from '@sentry/cloudflare';
import { parseChapters } from './chapter-parser';
import { signBoundContent } from '../crypto';

/**
 * Decoupled chapter persistence (chapters-decoupling design, 2026-08-06).
 *
 * Each analysis dispatches 5 parallel bundle streams (chunkIndex 1..5, same
 * metadata); this block used to run on ALL of them -- 5 identical parse+sign+POST
 * round trips per analysis for an idempotent upsert.
 *
 * Single-persist contract (2026-09-24): BUNDLE-1-AUTHORITATIVE, not
 * "first-arriving". Persistence fires iff the stream declares itself bundle 1
 * (chunkIndex === 1) or is a stale client that doesn't send chunkIndex
 * (undefined preserves the old always-persist behavior). If bundle 1's
 * request never reaches the worker at all, chapters are lost for that
 * analysis -- chapters are a cosmetic chip and the whole analysis is already
 * degraded in that case, so the loss window is accepted vs 5x the S2S spend.
 * (ADR 032 will move chapter parsing to Vercel's prepare step, so no heavier
 * once-per-analysis idempotency infrastructure is built here.)
 *
 * Extracted from worker/src/routes/analysis.ts (2026-09-24) so the gate,
 * the bounded error-snippet, and the non-2xx/exception reporting paths are
 * unit-testable without standing up a full Hono route.
 */
// skipcq: JS-0057 -- named exported function declaration is this repo's
// convention; the "wrap in an IIFE" advice doesn't apply to ES module scope.
export function shouldPersistChaptersForChunk(chunkIndex?: number | undefined): boolean {
  return chunkIndex === undefined || chunkIndex === 1;
}

/** Sentry `extra.bodySnippet` bound -- oversized bodies are truncated, never sent whole. */
export const CHAPTER_PERSIST_BODY_SNIPPET_MAX = 200;

/**
 * Bound the error-body snippet sent to logs/Sentry. The snippet comes from the
 * CHAPTERS ENDPOINT'S RESPONSE BODY ONLY -- never from request headers, the
 * signed request payload, or cookies -- so the worst it can carry is whatever
 * the Vercel route itself put in an error response (route-generated error JSON).
 */
// skipcq: JS-0057 -- named exported function declaration is this repo's
// convention; the "wrap in an IIFE" advice doesn't apply to ES module scope.
export function truncateBodySnippet(bodyText: string, max = CHAPTER_PERSIST_BODY_SNIPPET_MAX): string {
  return bodyText.length > max ? `${bodyText.slice(0, max)}...` : bodyText;
}

export interface ChapterPersistDeps {
  description: string | undefined;
  chunkIndex: number | undefined;
  signingKey: string;
  appUrl: string;
  videoId: string;
  waitUntil: (promise: Promise<unknown>) => void;
  fetchFn?: typeof fetch;
}

/**
 * Parse chapters from the video description and fire-and-forget one signed S2S
 * POST to /api/videos/[videoId]/chapters. Runs in parallel with the LLM stream --
 * chapters are independent of the analysis lifecycle. Non-2xx responses and
 * fetch rejections are reported to Sentry (phase 'chapter-persist') but never
 * throw: a chapters failure must not degrade the analysis stream.
 */
export function enqueueChapterPersist(deps: ChapterPersistDeps): void {
  if (deps.description === undefined) return;
  if (!shouldPersistChaptersForChunk(deps.chunkIndex)) return;
  if (!deps.signingKey) return;

  const chapters = parseChapters(deps.description);
  // skipcq: JS-0057 -- named exported function declaration is this repo's
  // convention; the "wrap in an IIFE" advice doesn't apply to ES module scope.
  deps.waitUntil((async () => {
    try {
      const exp = Date.now() + 120_000;
      const canonical = JSON.stringify({ chapters });
      const sig = await signBoundContent(deps.signingKey, 'chapters', deps.videoId, exp, canonical);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const doFetch = deps.fetchFn ?? fetch;
        const response = await doFetch(`${deps.appUrl}/api/videos/${deps.videoId}/chapters`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapters, sig, exp }),
          signal: controller.signal,
        });
        if (!response.ok) {
          // The abort timer stays active through the body read (cleared in
          // finally below): a stalled non-2xx body would otherwise hang the
          // waitUntil task forever with the timer already cleared.
          const bodyText = await response.text();
          const bodySnippet = truncateBodySnippet(bodyText);
          console.error('[analyze-llm-stream] Chapter persist returned non-2xx', {
            videoId: deps.videoId,
            status: response.status,
            body: bodySnippet,
          });
          // console.error alone made this failure invisible to alerting --
          // the 2026-09-23 production incident ("non-2xx on every stream")
          // ran for weeks with zero Sentry signal. Captured so the next
          // auth/route regression on this endpoint pages instead of
          // silently degrading every analysis' chapters chip.
          Sentry.captureMessage('Chapter persist returned non-2xx', {
            level: 'error',
            tags: { component: 'analyze-llm-stream', phase: 'chapter-persist' },
            extra: { videoId: deps.videoId, status: response.status, bodySnippet },
          });
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      // Rejected fetch (timeout/DNS/connection reset) previously only
      // console.warn'd -- same invisibility class as the non-2xx path above.
      // captureException (not captureMessage: this is a real thrown error),
      // no double-reporting -- the non-2xx path reports only itself.
      console.warn('[analyze-llm-stream] Chapter persist failed (non-blocking)', {
        videoId: deps.videoId,
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err, {
        tags: { component: 'analyze-llm-stream', phase: 'chapter-persist' },
        extra: { videoId: deps.videoId },
      });
    }
  })());
}
