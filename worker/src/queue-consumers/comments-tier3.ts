import * as Sentry from "@sentry/cloudflare";
import { MetadataScraper } from "../services/MetadataScraper";
import { signBoundContent } from "../crypto";
import type { CommentsTier3QueueMessage } from "../routes/comments";

/**
 * Tier 3 (uncapped) comment fetch consumer.
 *
 * Scope note (Phase 4, 2026-07-25): this consumer does the real paginated
 * fetch (MetadataScraper.fetchCommentsPage, Phase 3b) up to the message's
 * totalCommentCount, and reports the resulting sampled_count/status back to
 * Postgres via the same signed S2S pattern chat-stream.ts uses for
 * chat-persist. It deliberately does NOT persist the raw fetched comment
 * text anywhere yet -- where 30K+ raw comment bodies live before batched
 * classification (Phase 5) consumes them is an open storage-design question,
 * not something to improvise under this phase's time budget. Comments are
 * fetched into memory, counted, and discarded; only the count is durable.
 * This makes the consumer's real, verifiable job today "can we actually
 * pull N comments for this video via paginated commentThreads.list calls,
 * and report accurately how many we got" -- which is itself the open
 * question flagged in the plan doc, now answered in code rather than
 * left as a guess.
 */

type QueueConsumerEnv = {
  YOUTUBE_API_KEY: string;
  RESIDENTIAL_PROXY_URL?: string;
  STREAM_HMAC_SECRET: string;
  APP_URL?: string;
};

const PAGE_SIZE = 100; // YouTube Data API v3's documented maxResults ceiling for commentThreads.list.
// Bounds total worker execution time for one queue invocation. At ~200-400ms/page
// this budget covers a 30K-comment run (300 pages) with headroom; a run that
// hits this ceiling reports its partial count rather than failing silently.
const MAX_PAGES = 400;

async function reportSampleRunResult(
  env: QueueConsumerEnv,
  appUrl: string,
  sampleRunId: string,
  userId: string,
  result: { sampledCount: number; status: "completed" | "failed" },
): Promise<void> {
  const exp = Date.now() + 300_000;
  const payload = JSON.stringify({ sampleRunId, sampledCount: result.sampledCount, status: result.status });
  const sig = await signBoundContent(env.STREAM_HMAC_SECRET, "comments-tier3", sampleRunId, exp, payload);

  try {
    const res = await fetch(`${appUrl}/api/comments/persist-sample-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sampleRunId, userId, sampledCount: result.sampledCount, status: result.status, sig, exp }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // skipcq: JS-0827
      console.error(`[comments-tier3-consumer] persist-sample-run non-ok: ${res.status}`);
      Sentry.captureMessage("comments-tier3 persist-sample-run failed", {
        level: "error",
        tags: { operation: "comments-tier3-persist", status: String(res.status) },
        extra: { sampleRunId },
      });
    }
  } catch (err) {
    // skipcq: JS-0827
    console.error("[comments-tier3-consumer] persist-sample-run threw:", err instanceof Error ? err.message : String(err));
    Sentry.captureException(err, { tags: { operation: "comments-tier3-persist" }, extra: { sampleRunId } });
  }
}

export async function handleCommentsTier3Message(
  message: CommentsTier3QueueMessage,
  env: QueueConsumerEnv,
): Promise<void> {
  const { sampleRunId, videoId, userId, totalCommentCount, appUrl } = message;
  const scraper = new MetadataScraper(env.YOUTUBE_API_KEY, env.RESIDENTIAL_PROXY_URL);

  let sampledCount = 0;
  let pageToken: string | undefined;
  let pages = 0;

  try {
    while (sampledCount < totalCommentCount && pages < MAX_PAGES) {
      const page = await scraper.fetchCommentsPage(videoId, {
        pageToken,
        maxResultsPerPage: Math.min(PAGE_SIZE, totalCommentCount - sampledCount),
      });
      sampledCount += page.comments.length;
      pages += 1;
      if (page.exhausted || !page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }

    await reportSampleRunResult(env, appUrl, sampleRunId, userId, { sampledCount, status: "completed" });
  } catch (err) {
    // skipcq: JS-0827
    console.error(`[comments-tier3-consumer] fetch loop failed for ${videoId}:`, err instanceof Error ? err.message : String(err));
    Sentry.captureException(err, { tags: { operation: "comments-tier3-fetch-loop" }, extra: { sampleRunId, videoId, sampledCount } });
    await reportSampleRunResult(env, appUrl, sampleRunId, userId, { sampledCount, status: "failed" });
  }
}
