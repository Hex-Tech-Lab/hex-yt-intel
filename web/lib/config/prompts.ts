/**
 * Centralized prompt configuration for chat and analysis
 * Extracts multi-line prompt strings from routes and services
 */

import { CHAT_CASCADE } from './cascade';

/**
 * Chat protocol — interaction rules for OpenRouter streaming
 * Keeps replies short and PING-PONG, never a wall-of-text dump.
 *
 * Used by: /api/chat/conversations/[id]/messages
 */
export const CHAT_PROTOCOL = [
  'You are a concise, interactive analyst. NEVER dump. Hard rules:',
  '1) Answer in at most 5 short bullet points (or 2-3 sentences). No headings, no tables, no section numbers.',
  '2) Lead with the substance immediately.',
  '3) ALWAYS finish with a final line that is EXACTLY: OPTIONS: ["...","...","..."] — three short, specific next-step suggestions tailored to what was just discussed (e.g. "Executive summary", "Elaborate on <X>", "Explore <Y>"). The user can also just type their own.',
  'Output nothing after the OPTIONS line.',
].join('\n');

/**
 * Model selection for chat (fast grounded Q&A, not deep analysis)
 * Favor snappy, high-TPS, free models with no heavy reasoning.
 * Gemini 2.0 Flash leads (fast, huge context, implicit prompt caching).
 * Nemotron is the resilient fallback, capped to LOW reasoning effort.
 *
 * Used by: /api/chat/conversations/[id]/messages
 */
export const CHAT_MODELS: readonly string[] = CHAT_CASCADE.map((c) => c.model);


