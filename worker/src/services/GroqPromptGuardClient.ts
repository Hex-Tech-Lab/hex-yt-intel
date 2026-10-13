/**
 * GroqPromptGuardClient — Groq Llama Prompt Guard 2 API Client (ADR-043 Scaffolding)
 *
 * Implements interface and typed error hierarchy for screening prompt injection and jailbreaks.
 * Advance Scout stub: CCT will implement full sliding-window segment batching and Groq REST invocation.
 */

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

export class GroqPromptGuardClient implements IGroqPromptGuardClient {
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly defaultTimeoutMs: number;

  constructor(config: GroqPromptGuardConfig) {
    if (!config.apiKey) {
      throw new Error('GroqPromptGuardClient requires a valid apiKey');
    }
    this.apiKey = config.apiKey;
    this.defaultModel = config.model ?? 'meta-llama/llama-prompt-guard-2-86m';
    this.defaultTimeoutMs = config.timeoutMs ?? 5000;
  }

  /**
   * Evaluates a single text segment for prompt injection probability.
   * Stub implementation for Advance Scout phase; CCT will wire HTTP fetch.
   */
  public async scoreText(request: GroqPromptGuardScoreRequest): Promise<GroqPromptGuardScoreResponse> {
    throw new Error('GroqPromptGuardClient.scoreText: Not implemented (scaffolded for CCT Wave 2 implementation)');
  }

  /**
   * Concurrently scores a list of segmented windows with bounded parallelism.
   * Stub implementation for Advance Scout phase; CCT will wire HTTP fetch.
   */
  public async scoreBatch(texts: string[], options?: { timeoutMs?: number }): Promise<GroqPromptGuardScoreResponse[]> {
    throw new Error('GroqPromptGuardClient.scoreBatch: Not implemented (scaffolded for CCT Wave 2 implementation)');
  }
}
