/**
 * ReasoningEnginePort — Domain Port (Hexagonal-Lite)
 *
 * The reasoning engine contract plus the shared domain types it exchanges with the
 * orchestrator (worker.ts). Concrete services import these contracts rather than
 * each other, keeping the dependency graph pointing inward at the domain.
 *
 * BOUNDARY: pure domain — no HTTP Request/Response, no SSE. The orchestrator owns
 * transport; the engine owns reasoning.
 */

/** Domain fragment emitted during streaming (ADR 006: extended with persona/kg/classification). */
export interface DimensionFragment {
  type: 'dimension' | 'complete' | 'error' | 'persona' | 'kg' | 'classification';
  dimension?: number;
  name?: string;
  content?: string;
  config?: unknown;
  nodes?: unknown[];
  edges?: unknown[];
  rootId?: string | null;
  data?: unknown;
}

/** Domain metadata describing the source video. */
export interface EngineMetadata {
  title: string;
  channelTitle: string;
  publishedAt: string;
  duration: number;
  viewCount: string | number;
  likeCount: string | number;
  commentCount: string | number;
}

/** Domain input for a reasoning run. No HTTP, no transport — pure domain. */
export interface EngineContext {
  metadata: EngineMetadata;
  transcript: string;
  persona: string;
  timezone: string;
  /** Video id, used only as the deterministic cache-key suffix (legacy execute). */
  videoId?: string;
  /** Optional system prompt override (legacy /analyze-llm). Falls back to UCIS v5.1. */
  systemPrompt?: string;
  /** Optional dimension bundle for multi-stream execution. */
  dimensions?: number[];
}

/** Structured lifecycle event emitted during the cascade. */
export interface StreamStatusEvent {
  stage: 'model' | 'fallback';
  model?: string;
  from?: string;
  error?: string;
  rawError?: string;
}

/** Domain event handlers the orchestrator wires to its transport (SSE). */
export interface StreamHandlers {
  /** Raw LLM text chunk (for terminal/processing log). */
  onDelta: (text: string) => void;
  /** Parsed dimension/complete fragment (for the Bento grid). */
  onFragment: (fragment: DimensionFragment) => void;
  /** Cascade lifecycle status (model selection, fallback). */
  onStatus?: (status: StreamStatusEvent) => void;
}

/** Result of a streaming reasoning run. */
export interface StreamResult {
  finalText: string;
  modelUsed: string;
  valid: boolean;
  produced: boolean;
}

/** Result of a non-streaming reasoning run. */
export interface ExecuteResult {
  success: boolean;
  analysis?: string;
  model?: string;
  cached?: boolean;
  valid?: boolean;
  error?: string;
}

/** Upstash connection config (legacy alias; the cache port now insulates this). */
export interface CacheConfig {
  url: string;
  token: string;
}

/** The reasoning engine port: streaming + non-streaming execution. */
export interface ReasoningEnginePort {
  execute(context: EngineContext): Promise<ExecuteResult>;
  executeAndStream(
    context: EngineContext,
    handlers: StreamHandlers,
    signal?: AbortSignal
  ): Promise<StreamResult>;
  /** Passthrough so the orchestrator can validate partial markdown on abort. */
  validate12D(analysis: unknown): boolean;
}
