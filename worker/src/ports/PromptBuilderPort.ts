/**
 * PromptBuilderPort — Domain Port (Hexagonal-Lite)
 *
 * Builds the UCIS system prompt from domain objects. The concrete builder wraps
 * getUCISPrompt so the prompt IP stays server-side (bundled into the worker).
 */

import type { EngineContext } from './ReasoningEnginePort';

export interface PromptBuilderPort {
  build(context: EngineContext): Promise<string>;
  /**
   * Split the prompt into its cacheable shared prefix (identical across all
   * bundles of one video) and the bundle-specific segment instruction.
   * Contract: sharedPrefix + segmentInstruction === build(context),
   * byte-for-byte. Used by ReasoningEngine to place an Anthropic
   * cache_control breakpoint on the shared prefix (prompt caching, 2026-09-25).
   */
  buildSegmented(context: EngineContext): Promise<{ sharedPrefix: string; segmentInstruction: string }>;
}
