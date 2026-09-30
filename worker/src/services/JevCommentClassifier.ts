import * as Sentry from '@sentry/cloudflare';

import type {
  CommentClassificationPort,
  ClassifiedComment,
  CommentSentiment,
  CommentType,
} from '../ports/CommentClassificationPort';
import type { VideoComment } from '../ports/CommentIngestionPort';

/**
 * JevCommentClassifier — Adapter for CommentClassificationPort
 *
 * User directive 2026-09-30: classification/decisions use Jev
 * (TypeSafe System One, `~typesafe/jev-latest` via the OpenRouter Decisions
 * API `POST /api/alpha/decisions`) — never a chat LLM. Verified request/response
 * shapes and per-question contract come from the 2026-09-30 pilot
 * (111/111 ok, $0.0000278/comment, p50 0.46s — see docs/agent-prompts/
 * 2026-09-30-oc-jev-comment-classifier.md §1). One Decisions call per
 * comment with bounded concurrency; a failed call yields NO entry for that
 * comment (never a fabricated default) and is counted + reported once per batch.
 */

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest'; // resolves typesafe/jev-1.13-20260917
const HTTP_REFERER = 'https://getvintel.com';
const X_TITLE = 'hex-yt-intel/jev-comments';
const MAX_COMMENT_CHARS = 2000;

const VALID_SENTIMENTS: readonly CommentSentiment[] = ['positive', 'negative', 'neutral', 'mixed'];
const VALID_TYPES: readonly CommentType[] = [
  'question',
  'praise',
  'criticism',
  'suggestion',
  'experience',
  'spam',
  'off_topic',
];

/** Default config mirrors the registry seeds in the comments.jev.* migration. */
export interface JevClassifierConfig {
  minConfidence: number;
  concurrency: number;
  requestTimeoutMs: number;
}

export const JEV_CLASSIFIER_CONFIG_DEFAULTS: JevClassifierConfig = {
  minConfidence: 0.5,
  concurrency: 8,
  requestTimeoutMs: 15000,
};

/**
 * Pilot question set in the VERIFIED Decisions API shape (live-checked
 * 2026-09-30): `choice` and `noul` take a `criteria` record, `score` takes a
 * `criteria` array. A `choices` array or a `legend` object is rejected with
 * HTTP 400 ("expected record/array at criteria"). Pain-point wording is
 * literal-only (pilot issue: hyperbole read as real pain).
 */
export const JEV_COMMENT_QUESTIONS = {
  sentiment: {
    type: 'choice',
    instructions: 'Overall sentiment of this YouTube comment toward the video or its topic. Choose the single dominant label.',
    criteria: {
      positive: 'Approving, grateful, enthusiastic',
      negative: 'Critical, angry, disappointed',
      neutral: 'Factual or no clear feeling',
      mixed: 'Clearly both positive and negative',
    },
  },
  comment_type: {
    type: 'choice',
    instructions: 'The primary nature of the comment.',
    criteria: {
      question: 'Asks the creator or viewers something',
      praise: 'Compliments the video or creator',
      criticism: 'Criticizes the video or creator',
      suggestion: 'Proposes an idea or improvement',
      experience: 'Shares a personal story or situation related to the video',
      spam: 'Promotion, links, bots',
      off_topic: 'Unrelated to the video',
    },
  },
  pain_point: {
    type: 'noul',
    instructions:
      'Does the commenter LITERALLY describe a real problem, frustration or pain they personally experience or experienced? Jokes, memes, sarcasm and exaggeration (e.g. "I got up from my wheelchair to watch this") are NOT pain points even if they mention hardship.',
    criteria: {
      true: 'A real, literal personal problem is described',
      false: 'No literal personal problem (including jokes, memes, hyperbole)',
    },
  },
  question_asked: {
    type: 'noul',
    instructions: 'Does the comment ask a genuine question that expects an answer?',
    criteria: { true: 'Contains a genuine question', false: 'No question' },
  },
  intensity: {
    type: 'score',
    instructions: 'How strongly is the feeling expressed?',
    criteria: ['Mild', 'Moderate', 'Strong'],
  },
} as const;

interface JevAnswer {
  type?: string;
  choice?: string;
  noul?: number;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
}

interface JevResponse {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: { cost?: number };
}

interface DecodedComment {
  comment: VideoComment;
  text: string;
}

/** Decodes the common HTML entities YouTube comment text carries (&quot; &amp; &#39; &lt; &gt; &nbsp;) plus numeric refs. */
export function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    '&quot;': '"',
    '&amp;': '&',
    '&apos;': "'",
    '&#39;': "'",
    '&#x27;': "'",
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
  };
  return input
    .replace(/&(quot|amp|apos|lt|gt|nbsp);/g, (m) => named[m] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (...groups: string[]) => safeFromCode(parseInt(groups[1] ?? '', 16)))
    .replace(/&#(\d+);/g, (...groups: string[]) => safeFromCode(parseInt(groups[1] ?? '', 10)));
}

function safeFromCode(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch (error) {
    console.debug('[JevCommentClassifier] dropping an out-of-range numeric HTML entity', code, error instanceof Error ? error.message : String(error));
    return '';
  }
}

function sanitizeCommentText(raw: string): string {
  const text = decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim();
  return text.length > MAX_COMMENT_CHARS ? `${text.slice(0, MAX_COMMENT_CHARS - 3)}...` : text;
}

export class JevCommentClassifier implements CommentClassificationPort {
  constructor(
    private apiKey: string,
    private config: JevClassifierConfig = JEV_CLASSIFIER_CONFIG_DEFAULTS,
  ) {}

  async classifyBatch(comments: VideoComment[]): Promise<ClassifiedComment[]> {
    return (await this.classifyBatchWithCost(comments)).results;
  }

  /**
   * Same as classifyBatch, plus THIS invocation's own cost and failure count.
   * Everything is local to the call, so a reused instance or overlapping
   * batches (concurrent queue messages) never mix their totals.
   */
  async classifyBatchWithCost(
    comments: VideoComment[],
  ): Promise<{ results: ClassifiedComment[]; costUsd: number; failedCount: number }> {
    if (comments.length === 0) return { results: [], costUsd: 0, failedCount: 0 };

    const prepared: DecodedComment[] = comments.map((comment) => ({
      comment,
      text: sanitizeCommentText(comment.text),
    }));

    let failedCount = 0;
    let invalidResponseCount = 0;
    let costUsd = 0;
    const results: (ClassifiedComment | undefined)[] = new Array(prepared.length);
    let nextIndex = 0;
    let inFlight = 0;
    let peakInFlight = 0;

    const workers = Array.from(
      { length: Math.min(Math.max(1, this.config.concurrency), prepared.length) },
      async () => {
        for (;;) {
          const i = nextIndex;
          if (i >= prepared.length) return;
          nextIndex += 1;
          inFlight += 1;
          peakInFlight = Math.max(peakInFlight, inFlight);
          try {
            const entry = prepared[i];
            if (!entry) return;
            const outcome = await this.classifyOne(entry);
            results[i] = outcome.classified;
            costUsd += outcome.costUsd;
          } catch (error) {
            failedCount += 1;
            if (error instanceof JevResponseError) invalidResponseCount += 1;
            console.warn('[JevCommentClassifier] Decisions call failed', error instanceof Error ? error.message : String(error));
            // Deliberately leave results[i] undefined: a failed call yields NO
            // entry for that comment — never a fabricated default.
          } finally {
            inFlight -= 1;
          }
        }
      },
    );

    await Promise.all(workers);

    if (failedCount > 0) {
      Sentry.captureMessage('JevCommentClassifier: some Decisions calls failed for batch', {
        level: 'warning',
        tags: { operation: 'jev-comment-classify-batch' },
        extra: { batchSize: comments.length, failedCount, invalidResponseCount },
      });
    }

    return {
      results: results.filter((classified): classified is ClassifiedComment => classified !== undefined),
      costUsd,
      failedCount,
    };
  }

  /** Cost summed from `usage.cost` across the last classifyBatch's successful calls. */

  private async classifyOne(entry: DecodedComment): Promise<{ classified: ClassifiedComment; costUsd: number }> {
    const response = await this.callDecisions({ comment: entry.text });
    const answers = parseJevAnswers(response);
    const cost = response.usage?.cost;
    return {
      classified: {
        comment: entry.comment,
        ...answers,
        lowConfidence: answers.sentimentConfidence < this.config.minConfidence,
        modelUsed: typeof response.model === 'string' && response.model ? response.model : JEV_MODEL,
      },
      costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : 0,
    };
  }

  private async callDecisions(state: Record<string, unknown>): Promise<JevResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const res = await fetch(JEV_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': HTTP_REFERER,
          'X-Title': X_TITLE,
        },
        body: JSON.stringify({ model: JEV_MODEL, state, questions: JEV_COMMENT_QUESTIONS }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Jev Decisions ${res.status}`);
      }
      return (await res.json()) as JevResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A 200 response whose answers are missing, mistyped or out of range. */
export class JevResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JevResponseError';
  }
}

function requireUnit(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new JevResponseError(`${field} must be a number in [${min}, ${max}]`);
  }
  return value;
}

/**
 * Strict runtime validation of a Decisions response (#376 review P1): a
 * malformed or changed 200 response must NEVER be mapped to plausible
 * defaults (neutral / off_topic / 0). Anything missing, mistyped or out of
 * range throws JevResponseError, so the comment is omitted and counted.
 */
export function parseJevAnswers(response: JevResponse): Omit<ClassifiedComment, 'comment' | 'lowConfidence' | 'modelUsed'> {
  const answers = response.answers;
  if (!answers || typeof answers !== 'object') throw new JevResponseError('answers missing');
  const { sentiment, comment_type: commentTypeAnswer, pain_point: pain, question_asked: question, intensity } = answers;
  if (sentiment?.type !== 'choice' || !(VALID_SENTIMENTS as readonly string[]).includes(String(sentiment.choice))) {
    throw new JevResponseError('sentiment choice invalid');
  }
  if (commentTypeAnswer?.type !== 'choice' || !(VALID_TYPES as readonly string[]).includes(String(commentTypeAnswer.choice))) {
    throw new JevResponseError('comment_type choice invalid');
  }
  if (pain?.type !== 'noul') throw new JevResponseError('pain_point is not a noul answer');
  if (question?.type !== 'noul') throw new JevResponseError('question_asked is not a noul answer');
  if (intensity?.type !== 'score') throw new JevResponseError('intensity is not a score answer');
  return {
    sentiment: sentiment.choice as CommentSentiment,
    commentType: commentTypeAnswer.choice as CommentType,
    painPoint: requireUnit(pain.noul, 'pain_point.noul', 0, 1),
    questionAsked: requireUnit(question.noul, 'question_asked.noul', 0, 1),
    intensity: requireUnit(intensity.score, 'intensity.score', 0, 2),
    sentimentConfidence: requireUnit(sentiment.confidence, 'sentiment.confidence', 0, 1),
  };
}



