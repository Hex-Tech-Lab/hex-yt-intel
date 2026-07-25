import type {
  ChatPersistencePort,
  ModelResolutionPort,
  CryptographicTokenPort,
} from '@/lib/ports';
import type { UserTier } from '@/lib/types/billing';
import type { ChatMessage } from '@/lib/types/chat';
import { env } from '@/lib/env';
import { KnowledgeHistoryService } from '@/lib/services/KnowledgeHistoryService';
import type { UserKnowledgeContext } from '@/lib/types/knowledge-context';
import { buildGroundingWithHistory } from '@/lib/utils/build-grounding-with-history';
import { extractRequestedTranscriptRange } from '@/lib/utils/extract-transcript-range';
import { SupabaseBillingAdapter } from '@/lib/adapters/SupabaseBillingAdapter';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { getChatGroundingInstructions } from '@/lib/prompts/chat-grounding';

// Fallback used only if the settings registry is unreachable (see
// getRegistrySettings call below) -- matches the values these keys replaced
// (2026-07-24 Usage tab work, migration 20260723231500).
const CHAT_TURN_LIMIT_FALLBACK: Record<UserTier, number> = {
  free: 5,
  pro: 30,
  enterprise: 100,
};

// Fallback used only if the settings registry is unreachable -- see
// supabase/migrations/20260725130000_chat_transcript_range_leadin_settings.sql.
const CHAT_TRANSCRIPT_RANGE_LEADIN_SECONDS_FALLBACK = 5;

export interface ProcessChatMessageUseCaseParams {
  conversationId: string;
  userId: string;
  tier: UserTier;
  content: string;
  clientMsgId?: string | null;
}

export interface ProcessChatMessageSuccess {
  user: ChatMessage;
  assistant?: ChatMessage; // present if it's a retry and response already exists
  title?: string;
  stream?: {
    url: string;
    sig: string;
    exp: number;
  };
  payload?: {
    conversationId: string;
    userId: string;
    grounding: string;
    history: Array<{ role: string; content: string }>;
    models: string[];
    // Forwarded to the worker so AdaptiveOptionsBuilder can generate follow-up
    // OPTIONS that vary by conversation content instead of the static fallback.
    knowledgeContext?: UserKnowledgeContext;
  };
}

export type ProcessChatMessageResult =
  | { type: 'success'; data: ProcessChatMessageSuccess }
  | { type: 'error'; code: string; status: number; message: string };

export class ProcessChatMessageUseCase {
  constructor(
    private chatPersistence: ChatPersistencePort,
    private modelResolution: ModelResolutionPort,
    private tokenCrypto: CryptographicTokenPort,
    private knowledgeHistory: KnowledgeHistoryService
  ) {}

  async execute(params: ProcessChatMessageUseCaseParams): Promise<ProcessChatMessageResult> {
    const { conversationId, userId, tier, content: rawContent, clientMsgId } = params;

    const trimmedRaw = rawContent.trim();
    if (!trimmedRaw) {
      return { type: 'error', code: 'ERR_EMPTY_MESSAGE', status: 400, message: 'Empty message' };
    }

    let finalContent = trimmedRaw;
    const isReasoning = trimmedRaw.startsWith('/reason') || 
                        trimmedRaw.startsWith('/think') || 
                        /\b(reason|explain|verify|calculate|logic|why|analyze deeply|deep dive)\b/i.test(trimmedRaw);

    if (trimmedRaw.startsWith('/reason')) {
      finalContent = trimmedRaw.slice(7).trim();
    } else if (trimmedRaw.startsWith('/think')) {
      finalContent = trimmedRaw.slice(6).trim();
    }

    if (!finalContent) {
      return { type: 'error', code: 'ERR_EMPTY_MESSAGE', status: 400, message: 'Empty message' };
    }

    // 1. Load conversation, messages, and user knowledge context in parallel to avoid sequential network roundtrips
    const [conv, allMessages, knowledgeContext] = await Promise.all([
      this.chatPersistence.getConversation({ conversationId }),
      this.chatPersistence.getMessages({ conversationId }),
      this.knowledgeHistory.loadUserKnowledgeContext(userId),
    ]);

    if (!conv) {
      return { type: 'error', code: 'ERR_CONVERSATION_NOT_FOUND', status: 404, message: 'Conversation not found' };
    }
    if (conv.userId !== userId) {
      return { type: 'error', code: 'ERR_FORBIDDEN', status: 403, message: 'Forbidden' };
    }

    // 2. Idempotent user-message lookup (in-memory lookup from pre-loaded history)
    let userRow: ChatMessage | null = null;
    let isRetry = false;

    if (clientMsgId) {
      const existing = allMessages.find((m) => m.clientMsgId === clientMsgId);
      if (existing) {
        userRow = existing;
        isRetry = true;
      }
    }

    // 3. Enforce turn limits based on user tier. Values come from the
    // settings registry (Wave D1) as of 2026-07-24 -- see
    // supabase/migrations/20260723231500_chat_turn_limit_settings.sql.
    // getRegistrySettings itself never throws (falls back internally on any
    // DB error), and CHAT_TURN_LIMIT_FALLBACK matches the values these keys
    // replaced, so this call cannot change behavior on a registry outage.
    const userMessageCount = allMessages.filter((m) => m.role === 'user').length;

    const limits = await SupabaseSettingsAdapter.getRegistrySettings(
      ['chat.turnLimit.free', 'chat.turnLimit.pro', 'chat.turnLimit.enterprise'],
      {
        'chat.turnLimit.free': CHAT_TURN_LIMIT_FALLBACK.free,
        'chat.turnLimit.pro': CHAT_TURN_LIMIT_FALLBACK.pro,
        'chat.turnLimit.enterprise': CHAT_TURN_LIMIT_FALLBACK.enterprise,
      }
    );
    const userLimit = Number(limits[`chat.turnLimit.${tier}`]) || CHAT_TURN_LIMIT_FALLBACK[tier] || 5;

    if (userMessageCount >= userLimit && !isRetry) {
      return {
        type: 'error',
        code: 'ERR_CHAT_LIMIT_EXCEEDED',
        status: 403,
        message: `Turn limit reached. Your plan (${tier}) is limited to ${userLimit} user messages per conversation. Please upgrade or start a new chat.`,
      };
    }

    // 4. Create user message (if needed) and fetch grounding in parallel to minimize latency
    let groundingResult: any = null;
    if (!userRow) {
      try {
        const [createdMsg, ground] = await Promise.all([
          this.chatPersistence.createMessage({
            conversationId,
            userId,
            role: 'user',
            content: finalContent,
            clientMsgId,
          }).catch(async (error: any) => {
            // Handle race conditions/duplicate client message writes gracefully
            if (clientMsgId) {
              const raced = await this.chatPersistence.findMessageByClientMsgId({
                conversationId,
                clientMsgId,
              });
              if (raced) {
                isRetry = true;
                return raced;
              }
            }
            throw error;
          }),
          conv.analysisId
            ? this.chatPersistence.getAnalysisGrounding({ analysisId: conv.analysisId, userId })
            : Promise.resolve(null),
        ]);
        userRow = createdMsg;
        groundingResult = ground;

        // Usage-log: a genuinely new user turn was persisted (not the
        // idempotent-retry/race-recovery paths above, which reuse an
        // existing row and would double-count). Fire-and-forget,
        // best-effort -- logUsageEvent rethrows internally after its own
        // Sentry capture, so this MUST stay wrapped here; a logging failure
        // must never affect chat message processing.
        if (!isRetry) {
          SupabaseBillingAdapter.logUsageEvent({
            userId,
            action: 'chat_turn',
            metadata: {
              surface: conv.analysisId ? 'synthesis_console' : 'atlas',
              conversationId,
            },
          }).catch((logErr) => {
            console.warn('[ProcessChatMessageUseCase] Failed to log chat_turn usage event:', logErr);
          });
        }
      } catch (error) {
        console.error('[chat-usecase] Failed during parallel user-message write / grounding fetch:', error);
        throw error;
      }
    } else {
      // Message already exists, just fetch grounding if conversation has analysisId
      if (conv.analysisId) {
        groundingResult = await this.chatPersistence.getAnalysisGrounding({ analysisId: conv.analysisId, userId });
      }
    }

    // After creation / idempotent lookup the user row is always present.
    // Narrow the type once here so the rest of the flow needs no non-null assertions.
    if (!userRow) {
      console.error('[chat-usecase] Invariant violated: user message row missing after persistence');
      return {
        type: 'error',
        code: 'ERR_MESSAGE_PERSIST',
        status: 500,
        message: 'Failed to persist user message.',
      };
    }

    // 5. If it's a retry and we already generated a reply, return it immediately without regening
    if (isRetry) {
      const laterAssistant = await this.chatPersistence.findAssistantByParentId({
        conversationId,
        parentId: userRow.id,
      });
      if (laterAssistant) {
        return {
          type: 'success',
          data: {
            user: userRow,
            assistant: laterAssistant,
          },
        };
      }
    }

    // 6. Handle auto-titling for new chats
    let newTitle: string | undefined;
    if (conv.title === 'New chat') {
      const title = finalContent.slice(0, 60);
      newTitle = title;
      await this.chatPersistence.updateConversationTitle({
        conversationId,
        title,
      });
    }

    // 7. Get last 20 messages for context replay (constructed in-memory to save a query)
    const historyMessages = allMessages.some((m) => m.id === userRow.id)
      ? allMessages
      : [...allMessages, userRow];
    const HISTORY_TURNS = 20;
    const history = historyMessages.slice(-HISTORY_TURNS);

    // 8. GROUNDING GATE (security). The chat's entire universe is THIS video's
    // analysis — it must never answer from general knowledge or bind to another
    // video. If the bound analysis has no usable content, do NOT mint a stream
    // token; refuse with a controlled, persisted assistant turn instead. This is
    // what stops an ungrounded model from inventing answers (e.g. a full recipe)
    // for a video that has no transcript. Gating first also means the grounding
    // string below is only ever built for the has-content path (no dead branch).
    const groundedMarkdown =
      typeof groundingResult?.analysisMarkdown === 'string' ? groundingResult.analysisMarkdown.trim() : '';
    if (groundedMarkdown.length === 0) {
      const refusal =
        groundingResult?.status === 'processing'
          ? "This video's analysis is still being generated — I'll be able to answer from it once the synthesis finishes."
          : "I can only answer from this video's own analysis, and it doesn't have one: no transcript or captions were available, so there's nothing for me to ground on. Try a video that has captions and I'll answer strictly from its analysis.";
      const assistant = await this.chatPersistence.createMessage({
        conversationId,
        userId,
        role: 'assistant',
        content: refusal,
        parentMessageId: userRow.id,
      });
      return {
        type: 'success',
        data: {
          user: userRow,
          assistant,
          ...(newTitle ? { title: newTitle } : {}),
        },
      };
    }

    // 8b. Grounding retrieval — markdown is guaranteed non-empty past the gate.
    //
    // CONTEXT AVAILABILITY vs. SOURCE WEIGHTING (2026-07-23 redesign):
    // A prior pass conflated these into one "70/30 ratio" by hard-slicing each
    // section to a fixed character count (analysis 28,000 / transcript 12,000).
    // That breaks down for any video whose transcript exceeds ~12,000 chars
    // (roughly 15-20 minutes of speech) -- a "what was said at minute 52"
    // question on a 90-minute video would silently lose the relevant part of
    // the transcript, for no real reason: CHAT_CASCADE's models (gpt-oss-120b,
    // gemini-3.1-flash-lite, gemini-2.0-flash) all carry at least a 128K-token
    // context window, and the reasoning cascade's floor (o3-mini, gemini-1.5-pro,
    // claude-3.5-sonnet) is comparable or larger. A ~12K-character cap has no
    // relationship to any of these models' actual limits -- it was an arbitrary
    // number, not a real constraint.
    //
    // The two concerns are independent and need separate mechanisms:
    //   - AVAILABILITY: how much of each source the model can see at all. Fixed
    //     per tonight: comprehensive by default (include everything, no fixed
    //     per-section slice), truncating only the one naturally-unbounded field
    //     (transcript) and only when the real combined size would approach the
    //     cascade's actual floor context window -- computed below, not guessed.
    //   - WEIGHTING: which source the model should prefer when synthesizing an
    //     answer. This is a pure instruction concern -- deleting data can't
    //     implement "prefer this source," it can only make the other source
    //     unavailable. Expressed as an explicit sentence in the prompt instead.
    //
    // GROUNDING_CONTEXT_BUDGET_CHARS: 350,000 chars (~87,500 tokens at the
    // conservative ~4 chars/token estimate) reserves headroom out of the
    // 128K-token cascade floor for: this instruction preamble, description/
    // metadata/digest/analysis sections, up to 20 turns of conversation history,
    // and response output tokens. Only the transcript is trimmed against
    // whatever budget remains after every other section is included in full --
    // those are all naturally small (a paragraph, a JSON metadata blob capped
    // at 20KB upstream, an 11-dimension synthesis) and essentially never need
    // trimming in practice. Revisit this constant if CHAT_CASCADE's cheapest
    // model ever drops below 128K tokens.
    const GROUNDING_CONTEXT_BUDGET_CHARS = 350_000;

    const description = groundingResult.description;
    const descriptionSection = description
      ? `\n\n--- YOUTUBE VIDEO DESCRIPTION (contains official links & resources) ---\n${description}\n\n`
      : '';
    const channelSuffix = groundingResult.channelTitle ? ` by ${groundingResult.channelTitle}` : '';
    // Video/channel metadata come from the worker's ingestion + channel-scrape calls
    // (validation_report.metadata / .channelMeta) -- surfaced as raw JSON blocks
    // rather than hand-picked fields since their shape varies by source (YouTube
    // Data API vs Decodo scrape) and the LLM can read either shape directly.
    // Included in full: channelMeta is already capped at 20KB where it's
    // persisted (worker + persist route), and videoMetadata is a small,
    // bounded field set -- no second, smaller cap needed here.
    const videoMetadataSection = groundingResult.videoMetadata
      ? `\n\n--- VIDEO METADATA ---\n${JSON.stringify(groundingResult.videoMetadata, null, 2)}\n`
      : '';
    const channelMetadataSection = groundingResult.channelMetadata
      ? `\n\n--- CHANNEL METADATA ---\n${JSON.stringify(groundingResult.channelMetadata, null, 2)}\n`
      : '';
    // Dimension 0 (Snapshot/Overview/Key Takeaways/Detailed Summary) was
    // generated and shown in the product's Executive Summary panel, but
    // getAnalysisGrounding never selected `executive_digest` at all -- chat
    // only ever saw dimensions 1-11. Surfaced explicitly, ahead of the
    // 11-dimension body, since it's the highest-level synthesis of the video.
    const digest = groundingResult.executiveDigest;
    const executiveDigestSection = digest
      ? `\n\n--- DIMENSION 0: EXECUTIVE DIGEST ---\n${digest.snapshot ? `Snapshot: ${digest.snapshot}\n\n` : ''}${digest.overview ? `Overview: ${digest.overview}\n\n` : ''}${Array.isArray(digest.takeaways) && digest.takeaways.length > 0 ? `Key Takeaways:\n${digest.takeaways.map((t: string) => `- ${t}`).join('\n')}\n\n` : ''}${digest.detailedSummary ? `Detailed Summary: ${digest.detailedSummary}\n` : ''}`
      : '';

    // Top relevance-ordered comments (author/date/like-count metadata included so
    // the model can answer "who said X" / "when" questions, not just quote text).
    // Already capped at 20KB where persisted (worker + persist route), same as
    // channelMeta -- no second cap needed here.
    const comments = groundingResult.comments;
    const commentsSection = comments && comments.length > 0
      ? `\n\n--- TOP COMMENTS (author, date, likes) ---\n${comments.map((c: { author: string; publishedAt: string; likeCount: number; text: string }) => `[${c.author}, ${c.publishedAt}, ${c.likeCount} likes]: ${c.text}`).join('\n')}\n`
      : '';

    // Analysis (dims 1-11) is included in full -- a synthesized 11-dimension
    // markdown is dense and typically well under the budget on its own.
    const analysisSection = groundedMarkdown;

    // Deterministic range extraction: when the user asks for a specific
    // minute/timestamp range, don't rely on the model to find and quote
    // every matching line out of a large transcript blob -- extract them
    // here via regex (from the FULL, pre-truncation transcript, so this is
    // never affected by the transcript budget below) and inject as a
    // guaranteed-complete, separately labeled block. See
    // extract-transcript-range.ts for the full RCA: a soft prompt instruction
    // alone was confirmed insufficient (live test truncated to the first 2-3
    // lines of a requested minute and stopped, despite the full data existing).
    // Lead-in buffer (2026-07-25 live report): the matched minute boundary
    // often lands a few seconds AFTER the sentence actually relevant to the
    // user's question starts, since transcript segments don't align to round
    // numbers. Widening the extraction window's start earlier (registry-
    // driven, not hardcoded -- see extract-transcript-range.ts's doc comment)
    // ensures the excerpt includes that lead-in context.
    const leadInLimits = await SupabaseSettingsAdapter.getRegistrySettings(
      ['chat.transcriptRange.leadInSeconds'],
      { 'chat.transcriptRange.leadInSeconds': CHAT_TRANSCRIPT_RANGE_LEADIN_SECONDS_FALLBACK }
    );
    const leadInSeconds = Number(leadInLimits['chat.transcriptRange.leadInSeconds'])
      || CHAT_TRANSCRIPT_RANGE_LEADIN_SECONDS_FALLBACK;

    const requestedRange = groundingResult.transcript
      ? extractRequestedTranscriptRange(groundingResult.transcript, finalContent, leadInSeconds)
      : null;
    // Numbered with an explicit, checkable count: an open-ended "relay all of
    // it" instruction was confirmed insufficient on repeated live tests (the
    // model kept stopping after 2-3 lines, including when asked to translate
    // each line inline -- the extra per-line work seems to invite trimming).
    // A concrete target count the model can self-verify against, plus
    // separating "quote verbatim" from "then translate/analyze" into two
    // passes, is the strongest lever available without changing the
    // streaming architecture to buffer and post-validate server-side.
    const requestedRangeSection = requestedRange
      ? requestedRange.lines.length > 0
        ? `\n\n--- EVERY TRANSCRIPT LINE IN THE REQUESTED RANGE: EXACTLY ${requestedRange.lines.length} LINES, NUMBERED ---\nThis numbered list is the complete, guaranteed-correct answer to the user's time-range question. Step 1: quote all ${requestedRange.lines.length} numbered lines below VERBATIM AND IN FULL, in this same order, before writing anything else -- do not paraphrase, merge, or drop any of them. Step 2 (only if the user asked for translation/analysis): add that AFTER all ${requestedRange.lines.length} lines are quoted, not interleaved. Before sending your reply, count your quoted lines against ${requestedRange.lines.length} -- if your count is lower, you have failed this instruction and must go back and include the missing ones.\n${requestedRange.lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n`
        : `\n\n--- REQUESTED RANGE ---\nNo transcript lines fall within the range the user asked about -- tell them that plainly rather than inventing or approximating content.\n`
      : '';

    // Transcript is the one section sized by what's actually left of the
    // budget after everything else, instead of a fixed number picked in
    // advance -- so a 10-minute video's full transcript is never needlessly
    // trimmed, and a 5-hour video's transcript is trimmed by exactly as much
    // as it has to be, not by an arbitrary amount unrelated to its own length.
    const fixedSectionsLength =
      descriptionSection.length + videoMetadataSection.length + channelMetadataSection.length
      + executiveDigestSection.length + commentsSection.length + analysisSection.length
      + requestedRangeSection.length;
    const transcriptBudget = Math.max(0, GROUNDING_CONTEXT_BUDGET_CHARS - fixedSectionsLength);
    const transcriptSection = groundingResult.transcript
      ? `\n\n--- TRANSCRIPT (timestamped where available) ---\n${groundingResult.transcript.slice(0, transcriptBudget)}`
      : '';

    // Grounding constrains the SOURCE, never the APPLICATION. The universe of
    // facts is this one video's analysis — but the user (our primary persona is
    // a content-repurposing creator) may transform those facts into any format:
    // podcast scripts, blog/Medium posts, social threads, bullet lists, shopping
    // lists, action plans. Refuse only when asked for facts outside the source,
    // not when asked to reshape what the source contains.
    //
    // WEIGHTING (separate from the availability logic above): when the
    // structured analysis and the raw transcript could both answer a question,
    // prefer the analysis for synthesis/interpretation (it's already distilled
    // and organized by dimension) -- but the transcript is the authoritative
    // source for anything requiring exact wording, direct quotes, or a specific
    // timestamp, and must be used for those regardless of what the analysis says.
    const groundingInstructions = await getChatGroundingInstructions();
    let grounding = `You are the creative analyst for the YouTube video "${groundingResult.title}"${channelSuffix}. ${groundingInstructions}${descriptionSection}${videoMetadataSection}${channelMetadataSection}${executiveDigestSection}${commentsSection}--- ANALYSIS (Dimensions 1-11) ---\n${analysisSection}${transcriptSection}${requestedRangeSection}`;

    // 8c. Inject user's learning history into grounding context
    grounding = buildGroundingWithHistory(grounding, knowledgeContext, finalContent);

    // 9. Resolve LLM models based on reasoning flag
    const chatModels = isReasoning
      ? await this.modelResolution.resolveModels(tier, 'reasoning')
      : await this.modelResolution.resolveModels(tier, 'chat');

    // 10. Generate cryptographic stream token
    let sig: string;
    let exp: number;
    try {
      const token = await this.tokenCrypto.signChatToken({
        conversationId,
        userId,
        models: chatModels,
      });
      sig = token.sig;
      exp = token.exp;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ProcessChatMessageUseCase] Token signing failed:', msg);
      return {
        type: 'error',
        code: 'ERR_TOKEN_SIGNING_FAILED',
        status: 500,
        message: 'Security configuration error: unable to sign stream token.',
      };
    }

    return {
      type: 'success',
      data: {
        user: userRow,
        ...(newTitle ? { title: newTitle } : {}),
        stream: {
          url: `${env.cloudflareWorkerUrl}/chat-stream`,
          sig,
          exp,
        },
        payload: {
          conversationId,
          userId,
          grounding,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          models: chatModels,
          // Forwarded to the worker's AdaptiveOptionsBuilder so follow-up OPTIONS
          // actually vary by conversation content instead of always falling
          // through to the static fallback (this field was previously never
          // sent -- knowledgeContext was only folded into the grounding TEXT via
          // buildGroundingWithHistory, never passed as structured data).
          knowledgeContext,
        },
      },
    };
  }
}
