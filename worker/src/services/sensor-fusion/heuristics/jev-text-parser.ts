import * as Sentry from '@sentry/cloudflare';

/**
 * JEV semantic text heuristics (ADR 039 §1.4).
 *
 * Same Decisions API contract as JevCommentClassifier (`~typesafe/jev-latest`,
 * `score` questions take a `criteria` array). Four criteria labels map to
 * scores 0..3. Transcripts are scored in 8,000-character blocks and the block
 * scores are averaged. A failed or malformed call throws; never a fabricated
 * default.
 */

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest';
const HTTP_REFERER = 'https://getvintel.com';
const X_TITLE = 'hex-yt-intel/jev-text-heuristics';
/** Transcript block size sent per Decisions call. */
export const JEV_TEXT_CHUNK_CHARS = 8000;
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

/** A 200 response whose answers are missing, mistyped or out of range. */
export class JevTextResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JevTextResponseError';
  }
}

/** Literal `>>` speaker-turn count: no inference spent on typographic markers. */
export const countTurnMarkers = (transcript: string): number => (transcript.match(/>>/g) || []).length;

/** Splits a transcript into consecutive blocks of at most JEV_TEXT_CHUNK_CHARS characters; [] when it is blank. */
export const splitTranscript = (transcript: string): string[] => {
  const blocks = transcript.match(new RegExp(`[\\s\\S]{1,${JEV_TEXT_CHUNK_CHARS}}`, 'g')) ?? [];
  return blocks.filter((block) => block.trim() !== '');
};

/** True for a finite number in the 0-3 score range. */
const isScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3;

/** Strict validation of a Decisions response: malformed or out-of-range answers throw; a float score is rounded to an integer. */
export const parseJevTextScores = (response: JevResponse): JevTextScores => {
  const answers = response.answers;
  if (!answers || typeof answers !== 'object') throw new JevTextResponseError('answers missing');
  /** Reads one validated 0-3 score answer by question key. */
  const read = (key: keyof JevTextScores): number => {
    const answer = answers[key];
    if (answer?.type !== 'score' || !isScore(answer.score)) {
      throw new JevTextResponseError(`${key} must be a score in [0, 3]`);
    }
    return Math.round(answer.score);
  };
  return {
    direct_address_intensity: read('direct_address_intensity'),
    procedural_instruction_intensity: read('procedural_instruction_intensity'),
    tangential_fluff_intensity: read('tangential_fluff_intensity'),
  };
};

/** Scores a transcript chunk via the JEV Decisions API and adds the literal turn-marker count. */
export class JevTextParser {
  constructor(
    private apiKey: string,
    private config: JevTextParserConfig = JEV_TEXT_PARSER_CONFIG_DEFAULTS,
  ) {}

  /** One Decisions call scoring one block of text (callers keep it within JEV_TEXT_CHUNK_CHARS). */
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
          state: { text },
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

  /** Full text heuristics: block scores averaged into integers, plus the literal `>>` count of the whole transcript. */
  async analyze(transcript: string): Promise<TextHeuristics> {
    const blocks = splitTranscript(transcript);
    if (blocks.length === 0) throw new JevTextResponseError('transcript is empty');
    const totals: JevTextScores = {
      direct_address_intensity: 0,
      procedural_instruction_intensity: 0,
      tangential_fluff_intensity: 0,
    };
    for (const block of blocks) {
      const scores = await this.scoreChunk(block);
      totals.direct_address_intensity += scores.direct_address_intensity;
      totals.procedural_instruction_intensity += scores.procedural_instruction_intensity;
      totals.tangential_fluff_intensity += scores.tangential_fluff_intensity;
    }
    return {
      direct_address_intensity: Math.round(totals.direct_address_intensity / blocks.length),
      procedural_instruction_intensity: Math.round(totals.procedural_instruction_intensity / blocks.length),
      tangential_fluff_intensity: Math.round(totals.tangential_fluff_intensity / blocks.length),
      turn_marker_count: countTurnMarkers(transcript),
    };
  }
}
