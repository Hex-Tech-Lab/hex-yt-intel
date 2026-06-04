/**
 * IPromptBuilder — Domain Port (Hexagonal-Lite)
 *
 * Builds the UCIS system prompt from domain objects. The concrete builder wraps
 * getUCISPrompt so the prompt IP stays server-side (bundled into the worker).
 */

import type { EngineContext } from './IReasoningEngine';

export interface IPromptBuilder {
  build(context: EngineContext): string;
}
