/**
 * ChatIntentRouter — Domain Service for Chat Intent Classification (ADR-043 Part A)
 *
 * Implements ChatIntentRouterPort. One Jev Decisions call per chat turn via the
 * shared client in JevCommentClassifier (no second Jev client). A single
 * `choice` question over the closed intent set; labels outside the set are
 * rejected, never mapped to a default.
 *
 * Resolution rules:
 * - Disabled: general_grounded_qa, no Jev call.
 * - First turn: Jev label, or general_grounded_qa if Jev fails.
 * - Follow-up: inherit the prior intent unless Jev returns a label at or above
 *   overrideConfidence. Jev failure inherits the prior intent.
 * - Chip and timestamp suppression derive from the label (writing only).
 */

import { VALID_CHAT_INTENTS } from '../ports/ChatIntentRouterPort';
import { callJevDecisions, JEV_MODEL } from './JevCommentClassifier';
import type { JevResponse } from './JevCommentClassifier';
import { CHAT_INTENT_VERSION, type ChatTurnIntentMeta, type ModelTier } from '../../../web/lib/types/chat-intent';
import type {
  ChatIntentRouterPort,
  ChatIntentInput,
  ChatIntentOutput,
  ChatIntent,
} from '../ports/ChatIntentRouterPort';

export interface ChatIntentRouterConfig {
  openRouterApiKey: string;
  enabled: boolean;
  overrideConfidence: number;
  timeoutMs: number;
}

const MAX_MESSAGE_CHARS = 2000;
const FALLBACK_INTENT: ChatIntent = 'general_grounded_qa';

/** Jev question over the closed intent set. Criteria are the only valid labels. */
export const CHAT_INTENT_QUESTIONS = {
  intent: {
    type: 'choice',
    instructions:
      'Classify what the user wants from this chat message about a YouTube video. Choose the single dominant intent.',
    criteria: {
      writing: 'Asks to write, draft, rewrite or elaborate content such as a blog, post, script or summary for publishing',
      comments_lookup: 'Asks what viewers or commenters say, think or ask',
      citation_lookup: 'Asks where or when something is said in the video, or for a timestamp or quote',
      metadata: 'Asks about the video itself: title, channel, date, length, description or tags',
      general_grounded_qa: 'Any other question answered from the video analysis',
    },
  },
} as const;

interface ResolvedFields {
  intent: ChatIntent;
  confidence: number;
  jevVersion: string;
  isInherited: boolean;
  overrideApplied: boolean;
  priorIntent?: ChatIntent;
}

interface ParsedIntent {
  intent: ChatIntent;
  confidence: number;
  jevVersion: string;
}

function parseIntentAnswer(response: JevResponse): ParsedIntent {
  const answer = response.answers?.intent;
  if (!answer || answer.type !== 'choice') throw new Error('intent answer missing or not a choice');
  const label = answer.choice;
  if (typeof label !== 'string' || !(VALID_CHAT_INTENTS as readonly string[]).includes(label)) {
    throw new Error(`intent label outside closed set: ${String(label)}`);
  }
  const confidence = answer.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('intent confidence must be a number in [0, 1]');
  }
  const jevVersion = typeof response.model === 'string' && response.model ? response.model : JEV_MODEL;
  return { intent: label as ChatIntent, confidence, jevVersion };
}

export class ChatIntentRouter implements ChatIntentRouterPort {
  private readonly config: ChatIntentRouterConfig;

  constructor(config: ChatIntentRouterConfig) {
    this.config = config;
  }

  /**
   * Resolves the active intent contract for a chat turn. Never throws on Jev
   * failure: the turn falls back to the prior intent or general_grounded_qa.
   */
  public async resolveTurnIntent(input: ChatIntentInput): Promise<ChatIntentOutput> {
    if (!this.config.enabled) {
      return this.build({ intent: FALLBACK_INTENT, isInherited: false, overrideApplied: false, confidence: 1.0, jevVersion: 'disabled' });
    }

    let jev: ParsedIntent | null = null;
    try {
      jev = await this.classify(input.currentMessage);
    } catch (error) {
      console.warn('[ChatIntentRouter] Jev classification failed, falling back', error instanceof Error ? error.message : String(error));
    }

    const prior = input.priorIntent;
    const overrideThreshold = this.config.overrideConfidence;
    let result: ResolvedFields;

    if (!jev) {
      result = prior
        ? { intent: prior, confidence: 0, jevVersion: 'unavailable', isInherited: true, overrideApplied: false }
        : { intent: FALLBACK_INTENT, confidence: 0, jevVersion: 'unavailable', isInherited: false, overrideApplied: false };
    } else if (!prior) {
      result = { intent: jev.intent, confidence: jev.confidence, jevVersion: jev.jevVersion, isInherited: false, overrideApplied: false };
    } else if (jev.confidence >= overrideThreshold) {
      result = {
        intent: jev.intent,
        confidence: jev.confidence,
        jevVersion: jev.jevVersion,
        isInherited: false,
        overrideApplied: jev.intent !== prior,
      };
    } else {
      result = { intent: prior, confidence: jev.confidence, jevVersion: jev.jevVersion, isInherited: true, overrideApplied: false };
    }

    console.info(
      '[ChatIntentRouter] resolved',
      JSON.stringify({
        label: result.intent,
        confidence: result.confidence,
        jevVersion: result.jevVersion,
        fallback: jev === null,
        inherited: result.isInherited,
        override: result.overrideApplied,
      }),
    );

    return this.build({ ...result, priorIntent: prior });
  }

  private build(fields: ResolvedFields): ChatIntentOutput {
    const suppress = fields.intent === 'writing';
    return {
      intent: fields.intent,
      confidence: fields.confidence,
      jevVersion: fields.jevVersion,
      isInherited: fields.isInherited,
      ...(fields.priorIntent ? { priorIntent: fields.priorIntent } : {}),
      overrideApplied: fields.overrideApplied,
      suppressCommentsChip: suppress,
      suppressTimestamps: suppress,
    };
  }

  private async classify(message: string): Promise<ParsedIntent> {
    const text = message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS - 3)}...` : message;
    const response = await callJevDecisions(
      this.config.openRouterApiKey,
      { state: { message: text }, questions: CHAT_INTENT_QUESTIONS, xTitle: 'vIntel - Chat Intent Router' },
      this.config.timeoutMs,
    );
    return parseIntentAnswer(response);
  }
}

/** Intents that are never downgraded, regardless of the registry mapping. */
const NEVER_DOWNGRADED: ReadonlySet<ChatIntent> = new Set<ChatIntent>(['writing', 'general_grounded_qa']);

/**
 * Model tier for an intent. `cheap` only when the registry mapping explicitly
 * permits it for that intent. Writing and general_grounded_qa are a hard floor at primary.
 */
export function resolveModelTier(intent: ChatIntent, modelByIntent: Record<string, ModelTier>): ModelTier {
  if (NEVER_DOWNGRADED.has(intent)) return 'primary';
  return modelByIntent[intent] === 'cheap' ? 'cheap' : 'primary';
}

/** The per-turn contract carried on the SSE `meta` frame (ADR-043 Part A). Type lives in web/lib/types/chat-intent. */
export function buildTurnIntentMeta(output: ChatIntentOutput, modelByIntent: Record<string, ModelTier>): ChatTurnIntentMeta {
  return {
    intent: output.intent,
    suppressCommentsChip: output.suppressCommentsChip,
    suppressTimestamps: output.suppressTimestamps,
    modelTier: resolveModelTier(output.intent, modelByIntent),
    intentVersion: CHAT_INTENT_VERSION,
  };
}
