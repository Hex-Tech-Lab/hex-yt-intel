import * as Sentry from '@sentry/cloudflare';

/**
 * JEV semantic text heuristics (ADR 039 §1.4).
 *
 * Same Decisions API contract as JevCommentClassifier (`~typesafe/jev-latest`,
 * `score` questions take a `criteria` array). Four criteria labels map to
 * scores 0..3. A failed or malformed call throws; never a fabricated default.
 */

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest';
const HTTP_REFERER = 'https://getvintel.com';
const X_TITLE = 'hex-yt-intel/jev-text-heuristics';
const MAX_CHUNK_CHARS = 8000;
const SCORE_LABELS = ['None', 'Low', 'Moderate', 'High'] as const;

export const JEV_TEXT_HEURISTIC_QUESTIONS = {
  direct_address_intensity: {
    type: 'score',
    instructions:
      'How strongly does the speaker address the audience directly (e.g. "you guys", "subscribe", "like and comment", vlogging calls to action)?',
    criteria: [...SCORE_LABELS],
  },
  procedural_instruction_intensity: {
    type: 'score',
    instructions:
      'How strongly does the text describe step-by-step procedures, UI interactions or physical actions the viewer is told to perform?',
    criteria: [...SCORE_LABELS],
  },
  tangential_fluff_intensity: {
    type: 'score',
    instructions:
      'How strongly does the text rely on filler and tangents (discourse markers such as "anyways", "so yeah", off-topic asides)?',
    criteria: [...SCORE_LABELS],
  },
} as const;

export interface JevTextScores {
  direct_address_intensity: number;
  procedural_instruction_intensity: number;
  tangential_fluff_intensity: number;
}

export interface TextHeuristics extends JevTextScores {
  turn_marker_count: number;
}

export interface JevTextParserConfig {
  requestTimeoutMs: number;
}

export const JEV_TEXT_PARSER_CONFIG_DEFAULTS: JevTextParserConfig = { requestTimeoutMs: 15000 };

interface JevAnswer {
  type?: string;
  score?: number;
}
interface JevResponse {
  answers?: Record<string, JevAnswer>;
}

export class JevTextResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JevTextResponseError';
  }
}

/** Literal `>>` speaker-turn count: no inference spent on typographic markers. */
export function countTurnMarkers(transcript: string): number {
  return (transcript.match(/>>/g) || []).length;
}

export function parseJevTextScores(response: JevResponse): JevTextScores {
  const answers = response.answers;
  if (!answers || typeof answers !== 'object') throw new JevTextResponseError('answers missing');
  const read = (key: keyof JevTextScores): number => {
    const answer = answers[key];
    const score = answer?.score;
    if (answer?.type !== 'score' || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 3) {
      throw new JevTextResponseError(`${key} must be a score in [0, 3]`);
    }
    return score;
  };
  return {
    direct_address_intensity: read('direct_address_intensity'),
    procedural_instruction_intensity: read('procedural_instruction_intensity'),
    tangential_fluff_intensity: read('tangential_fluff_intensity'),
  };
}

export class JevTextParser {
  constructor(
    private apiKey: string,
    private config: JevTextParserConfig = JEV_TEXT_PARSER_CONFIG_DEFAULTS,
  ) {}

  async scoreChunk(text: string): Promise<JevTextScores> {
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
        body: JSON.stringify({
          model: JEV_MODEL,
          state: { text: text.slice(0, MAX_CHUNK_CHARS) },
          questions: JEV_TEXT_HEURISTIC_QUESTIONS,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Jev Decisions ${res.status}`);
      return parseJevTextScores((await res.json()) as JevResponse);
    } catch (error) {
      Sentry.captureException(error, { tags: { operation: 'jev-text-heuristics' } });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async analyze(transcript: string): Promise<TextHeuristics> {
    return { ...(await this.scoreChunk(transcript)), turn_marker_count: countTurnMarkers(transcript) };
  }
}
