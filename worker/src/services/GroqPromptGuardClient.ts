/**
 * GroqPromptGuardClient — Groq Llama Prompt Guard 2 API Client (ADR-043 Part B)
 *
 * Calls the Groq chat-completions endpoint with a Prompt Guard model and maps the
 * classification output to a 0..1 attack score. The API key is injected by the caller
 * and must come from the environment (ADR 016); it is never stored in the registry.
 *
 * UNVERIFIED CONTRACT: Groq's docs confirm the model ids and the chat-completions call,
 * but do not document a numeric score or the exact output labels. The label mapping
 * below (BENIGN -> 0, MALICIOUS -> 1) is a binary assumption and must be checked against
 * a live response before `block` mode is considered.
 */

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-prompt-guard-2-86m';
const DEFAULT_TIMEOUT_MS = 5000;
const BATCH_CONCURRENCY = 4;

export interface GroqPromptGuardConfig {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface GroqPromptGuardScoreRequest {
  text: string;
  model?: string;
  timeoutMs?: number;
}

export interface GroqPromptGuardScoreResponse {
  score: number; // 0.0 (benign) to 1.0 (jailbreak / injection)
  model: string;
  latencyMs: number;
  rawResponse?: Record<string, unknown>;
}

export class GroqPromptGuardError extends Error {
  public readonly status?: number;
  public readonly isTimeout: boolean;
  public readonly isRateLimit: boolean;

  constructor(message: string, options?: { status?: number; isTimeout?: boolean; isRateLimit?: boolean }) {
    super(message);
    this.name = 'GroqPromptGuardError';
    this.status = options?.status;
    this.isTimeout = options?.isTimeout ?? false;
    this.isRateLimit = options?.isRateLimit ?? false;
  }
}

export class GroqPromptGuardTimeoutError extends GroqPromptGuardError {
  constructor(timeoutMs: number) {
    super(`Groq Prompt Guard request timed out after ${timeoutMs}ms`, { isTimeout: true });
    this.name = 'GroqPromptGuardTimeoutError';
  }
}

export class GroqPromptGuardRateLimitError extends GroqPromptGuardError {
  constructor(retryAfterMs?: number) {
    super(`Groq Prompt Guard rate limit exceeded (429)${retryAfterMs ? `; retry after ${retryAfterMs}ms` : ''}`, {
      status: 429,
      isRateLimit: true,
    });
    this.name = 'GroqPromptGuardRateLimitError';
  }
}

export interface IGroqPromptGuardClient {
  scoreText(request: GroqPromptGuardScoreRequest): Promise<GroqPromptGuardScoreResponse>;
  scoreBatch(texts: string[], options?: { timeoutMs?: number }): Promise<GroqPromptGuardScoreResponse[]>;
}

/** Maps the classifier's text output to a score. Unknown labels throw (caller fails open). */
function labelToScore(content: unknown): number {
  const label = typeof content === 'string' ? content.trim().toUpperCase() : '';
  if (label === 'BENIGN') return 0;
  if (label === 'MALICIOUS') return 1;
  throw new GroqPromptGuardError(`Groq Prompt Guard returned an unrecognised label: ${label.slice(0, 40) || '(empty)'}`);
}

export class GroqPromptGuardClient implements IGroqPromptGuardClient {
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly defaultTimeoutMs: number;

  constructor(config: GroqPromptGuardConfig) {
    if (!config.apiKey) {
      throw new Error('GroqPromptGuardClient requires a valid apiKey');
    }
    this.apiKey = config.apiKey;
    this.defaultModel = config.model ?? DEFAULT_MODEL;
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Evaluates a single text segment. Timeout, 429 and 5xx surface as typed errors.
   */
  public async scoreText(request: GroqPromptGuardScoreRequest): Promise<GroqPromptGuardScoreResponse> {
    const model = request.model ?? this.defaultModel;
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const started = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: request.text }],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new GroqPromptGuardTimeoutError(timeoutMs);
      throw new GroqPromptGuardError(error instanceof Error ? error.message : 'Groq Prompt Guard network error');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      throw new GroqPromptGuardRateLimitError(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : undefined);
    }
    if (!response.ok) {
      throw new GroqPromptGuardError(`Groq Prompt Guard returned HTTP ${response.status}`, { status: response.status });
    }

    const body = (await response.json()) as {
      model?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    return {
      score: labelToScore(content),
      model: typeof body.model === 'string' ? body.model : model,
      latencyMs: Date.now() - started,
      rawResponse: body as Record<string, unknown>,
    };
  }

  /**
   * Scores a list of segments with bounded parallelism. Result order matches input order.
   * Any segment failure rejects the batch; the caller decides the fail-open verdict.
   */
  public async scoreBatch(texts: string[], options?: { timeoutMs?: number }): Promise<GroqPromptGuardScoreResponse[]> {
    const results: GroqPromptGuardScoreResponse[] = new Array(texts.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < texts.length) {
        const index = next++;
        results[index] = await this.scoreText({ text: texts[index] ?? '', timeoutMs: options?.timeoutMs });
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, texts.length) }, () => worker()));
    return results;
  }
}
