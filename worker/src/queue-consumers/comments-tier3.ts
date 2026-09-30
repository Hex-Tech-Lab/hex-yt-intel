import * as Sentry from "@sentry/cloudflare";
import { canonicalJson } from "../../../web/lib/utils/canonical-json";
import { validateCochranSamplingConfig } from "../../../web/lib/config/comments-sampling-config";
import { MetadataScraper } from "../services/MetadataScraper";
import { signBoundContent } from "../crypto";
import { JevCommentClassifier, type JevClassifierConfig } from "../services/JevCommentClassifier";
import {
  dedupePool,
  selectStratifiedSample,
  buildCommentInsights,
  type CochranSamplingParams,
  type CommentInsights,
} from "../services/cochran-mode-engine";
import type { CommentsTier3QueueMessage } from "../routes/comments";

/**
 * Tier 3 comment consumer.
 *
 * Two modes (Comments Dispatch A, 2026-09-30):
 * - 'uncapped' (default / legacy): paginated fetch up to totalCommentCount
 *   (MAX_PAGES cap), comments are counted and DISCARDED — only the count is
 *   reported. Unchanged from the Phase 4 behavior.
 * - 'cochran': fetch a relevance-ordered pool and a time-ordered pool
 *   (registry-capped page counts carried in the signed message),
 *   de-duplicate by comment id, Cochran n with finite-population correction,
 *   stratified sample (like × recency), classify via JevCommentClassifier,
 *   and send both the classifications and the computed commentInsights to
 *   the signed S2S persist route. Sampling/classifier parameter values must
   * travel in the signed message: the consumer never invents defaults
 *   silently — a missing value fails the run loudly (log + Sentry).
 */

type QueueConsumerEnv = {
  YOUTUBE_API_KEY: string;
  OPENROUTER_API_KEY?: string;
  RESIDENTIAL_PROXY_URL?: string;
  STREAM_HMAC_SECRET: string;
  APP_URL?: string;
};

const PAGE_SIZE = 100; // YouTube Data API v3's documented maxResults ceiling for commentThreads.list.
// Bounds total worker execution time for one queue invocation. At ~200-400ms/page
// this budget covers a 30K-comment run (300 pages) with headroom; a run that
// hits this ceiling reports its partial count rather than failing silently.
const MAX_PAGES = 400;

export interface PersistClassificationRow {
  commentExternalId: string;
  commentText: string;
  likeCount: number;
  publishedAt: string;
  author: string;
  sentiment: string;
  commentType: string;
  painPoint: number;
  questionAsked: number;
  intensity: number;
  sentimentConfidence: number;
  lowConfidence: boolean;
  modelUsed: string;
}

export interface CochranPersistPayload {
  mode: "cochran";
  sampledCount: number;
  population: number;
  insights: CommentInsights;
  classifications: PersistClassificationRow[];
  sampledComments: Array<{ author: string; text: string; publishedAt: string; likeCount: number }>;
}

/** Stable key for a comment YouTube returned without an id: sha-256 of author|publishedAt|text. */
export async function stableCommentKey(comment: { author: string; publishedAt: string; text: string }): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${comment.author}|${comment.publishedAt}|${comment.text}`));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

export interface SampleRunResult {
  sampledCount: number;
  status: "sampling" | "completed" | "failed";
  comments?: Array<{ author: string; text: string; publishedAt: string; likeCount: number }>;
  cochran?: CochranPersistPayload;
}

async function reportSampleRunResult(
  env: QueueConsumerEnv,
  appUrl: string,
  sampleRunId: string,
  userId: string,
  mode: "uncapped" | "cochran",
  result: SampleRunResult,
): Promise<void> {
  const exp = Date.now() + 300_000;
  // #378 review P1: the signature covers the ENTIRE write body (canonical
  // JSON, keys sorted), so classifications/insights/comments/mode cannot be
  // altered under a valid signature. `mode` is sent on EVERY callback
  // (heartbeat, success, failure) so the route never infers it.
  const writeBody = {
    sampleRunId,
    userId,
    mode,
    sampledCount: result.sampledCount,
    status: result.status,
    comments: result.comments ?? [],
    cochran: result.cochran,
  };
  const sig = await signBoundContent(env.STREAM_HMAC_SECRET, "comments-tier3", sampleRunId, exp, canonicalJson(writeBody));

  try {
    const res = await fetch(`${appUrl}/api/comments/persist-sample-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...writeBody, sig, exp }),
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

/** Pages one ordered pool up to `maxPages` pages, stopping when YouTube reports exhaustion. */
async function fetchPool(
  scraper: MetadataScraper,
  videoId: string,
  order: "relevance" | "time",
  maxPages: number,
): Promise<Array<{ author: string; text: string; publishedAt: string; likeCount: number; externalId?: string }>> {
  const collected: Array<{ author: string; text: string; publishedAt: string; likeCount: number; externalId?: string }> = [];
  let pageToken: string | undefined;
  let pages = 0;
  while (pages < maxPages) {
    const page = await scraper.fetchCommentsPage(videoId, { pageToken, maxResultsPerPage: PAGE_SIZE, order });
    collected.push(...page.comments);
    pages += 1;
    if (page.exhausted || !page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return collected;
}

/** Runs the full cochran pipeline. Throws on hard failure; the caller reports status='failed'. */
async function runCochranMode(
  message: CommentsTier3QueueMessage,
  env: QueueConsumerEnv,
  scraper: MetadataScraper,
): Promise<CochranPersistPayload> {
  const validation = validateCochranSamplingConfig(message.sampling);
  const missing = [
    ...(validation.ok ? [] : validation.errors),
    ...(env.OPENROUTER_API_KEY ? [] : ["OPENROUTER_API_KEY missing"]),
  ];
  if (!validation.ok || missing.length > 0) {
    // #378 review P2: finite / integer / range checks, not just typeof -- a
    // bad value must fail the run loudly, never shrink the pool to nothing.
    const detail = `cochran mode invoked with an invalid sampling config: ${missing.join("; ")}`;
    // skipcq: JS-0827
    console.error(`[comments-tier3-consumer] ${detail}`, { sampleRunId: message.sampleRunId });
    Sentry.captureMessage("comments-tier3 cochran run has an invalid sampling config", {
      level: "error",
      tags: { operation: "comments-tier3-cochran" },
      extra: { sampleRunId: message.sampleRunId, missing },
    });
    throw new Error(detail);
  }
  const sampling = validation.config;
  const openRouterApiKey = env.OPENROUTER_API_KEY as string; // presence checked above

  const classifierConfig: JevClassifierConfig = {
    minConfidence: sampling.minConfidence,
    concurrency: sampling.classifierConcurrency,
    requestTimeoutMs: sampling.classifierRequestTimeoutMs,
  };
  const engineParams: CochranSamplingParams = {
    syncPoolMaxPages: sampling.syncPoolMaxPages,
    recencyPoolMaxPages: sampling.recencyPoolMaxPages,
    likeBucketCount: sampling.likeBucketCount,
    recencyBucketCount: sampling.recencyBucketCount,
    cochran: sampling.cochran,
  };

  const [relevancePool, timePool] = await Promise.all([
    fetchPool(scraper, message.videoId, "relevance", Math.min(sampling.syncPoolMaxPages, MAX_PAGES)),
    fetchPool(scraper, message.videoId, "time", Math.min(sampling.recencyPoolMaxPages, MAX_PAGES)),
  ]);

  const pool = dedupePool([...relevancePool, ...timePool]);
  const sample = selectStratifiedSample(pool, engineParams);

  const classifier = new JevCommentClassifier(openRouterApiKey, classifierConfig);
  const classification = await classifier.classifyBatchWithCost(sample);

  const insights = buildCommentInsights({
    poolSize: pool.length,
    reportedTotal: message.totalCommentCount,
    sampleSize: sample.length,
    classification,
    cochran: sampling.cochran,
  });

  const classifications: PersistClassificationRow[] = await Promise.all(classification.results.map(async (result) => ({
    // #378 review P2: a NULL key never collides in a Postgres unique index,
    // so an ID-less comment would duplicate on every retry. Fall back to a
    // stable content hash.
    commentExternalId: result.comment.externalId ?? (await stableCommentKey(result.comment)),
    commentText: result.comment.text,
    likeCount: result.comment.likeCount,
    publishedAt: result.comment.publishedAt,
    author: result.comment.author,
    sentiment: result.sentiment,
    commentType: result.commentType,
    painPoint: result.painPoint,
    questionAsked: result.questionAsked,
    intensity: result.intensity,
    sentimentConfidence: result.sentimentConfidence,
    lowConfidence: result.lowConfidence,
    modelUsed: result.modelUsed,
  })));

  return {
    mode: "cochran",
    sampledCount: sample.length,
    population: pool.length,
    insights,
    classifications,
    sampledComments: sample.map((comment) => ({
      author: comment.author,
      text: comment.text,
      publishedAt: comment.publishedAt,
      likeCount: comment.likeCount,
    })),
  };
}

export async function handleCommentsTier3Message(
  message: CommentsTier3QueueMessage,
  env: QueueConsumerEnv,
): Promise<void> {
  const { sampleRunId, videoId, userId, totalCommentCount, appUrl } = message;
  const mode = message.mode === "cochran" ? "cochran" : "uncapped";

  if (message.mode === "cochran") {
    // Contract (Dispatch A §1.4): pending -> sampling -> completed|failed.
    // Fire-and-forget: a failed sampling report must not abort the run.
    await reportSampleRunResult(env, appUrl, sampleRunId, userId, mode, {
      sampledCount: 0,
      status: "sampling",
    });
    const scraper = new MetadataScraper(env.YOUTUBE_API_KEY, env.RESIDENTIAL_PROXY_URL);
    try {
      const cochran = await runCochranMode(message, env, scraper);
      await reportSampleRunResult(env, appUrl, sampleRunId, userId, mode, {
        sampledCount: cochran.sampledCount,
        status: "completed",
        cochran,
      });
    } catch (err) {
      // skipcq: JS-0827
      console.error(`[comments-tier3-consumer] cochran run failed for ${videoId}:`, err instanceof Error ? err.message : String(err));
      Sentry.captureException(err, { tags: { operation: "comments-tier3-cochran" }, extra: { sampleRunId, videoId } });
      await reportSampleRunResult(env, appUrl, sampleRunId, userId, mode, { sampledCount: 0, status: "failed" });
    }
    return;
  }

  const scraper = new MetadataScraper(env.YOUTUBE_API_KEY, env.RESIDENTIAL_PROXY_URL);

  let sampledCount = 0;
  let pageToken: string | undefined;
  let pages = 0;
  const collectedComments: Array<{ author: string; text: string; publishedAt: string; likeCount: number }> = [];

  try {
    while (sampledCount < totalCommentCount && pages < MAX_PAGES) {
      const page = await scraper.fetchCommentsPage(videoId, {
        pageToken,
        maxResultsPerPage: Math.min(PAGE_SIZE, totalCommentCount - sampledCount),
      });
      collectedComments.push(...page.comments);
      sampledCount += page.comments.length;
      pages += 1;
      if (page.exhausted || !page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }

    await reportSampleRunResult(env, appUrl, sampleRunId, userId, mode, {
      sampledCount,
      status: "completed",
      comments: collectedComments,
    });
  } catch (err) {
    // skipcq: JS-0827
    console.error(`[comments-tier3-consumer] fetch loop failed for ${videoId}:`, err instanceof Error ? err.message : String(err));
    Sentry.captureException(err, { tags: { operation: "comments-tier3-fetch-loop" }, extra: { sampleRunId, videoId, sampledCount } });
    await reportSampleRunResult(env, appUrl, sampleRunId, userId, mode, {
      sampledCount,
      status: "failed",
      comments: collectedComments,
    });
  }
}
