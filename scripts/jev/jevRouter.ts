/**
 * Minimal client for the OpenRouter Decisions API (alpha.decisions) backed by
 * TypeSafe's Jev model. Jev answers three question primitives:
 *   - "noul"   -> probability the answer is true      (answers[k].noul, 0..1)
 *   - "choice" -> one of the criteria keys            (answers[k].choice)
 *   - "score"  -> ordinal index into the criteria list (answers[k].score)
 * Endpoint and schema per https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request
 */
import { readFileSync } from 'node:fs';

export const JEV_MODEL = 'typesafe/jev-1.13';
const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
/** Upper bound on one Jev call so a stalled request cannot hang the harness. */
const REQUEST_TIMEOUT_MS = 60_000;

export type NoulQuestion = {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
};
export type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};
export type ScoreQuestion = {
  type: 'score';
  instructions: string;
  criteria: string[];
};
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, string> };

export type JevResponse = {
  id: string;
  model: string;
  provider: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number; cost: number };
};

/** Reads one KEY=value entry from a dotenv-style file (LF or CRLF). Never logs the value. */
export function readEnvKey(envFile: string, key: string): string {
  const prefix = `${key}=`;
  const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`${key} not found in ${envFile}`);
  return line.replace(prefix, '').trim().replace(/^['"]|['"]$/g, '');
}

export async function askJev(
  apiKey: string,
  questions: Record<string, JevQuestion>,
  state: Record<string, unknown>,
): Promise<{ response: JevResponse; latencyMs: number }> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: JEV_MODEL, questions, state }),
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Jev request failed: HTTP ${res.status} ${body}`);
    }
    return { response: JSON.parse(body) as JevResponse, latencyMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}
