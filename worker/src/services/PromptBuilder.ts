/**
 * PromptBuilder - Pure Service (stateless)
 *
 * Implements PromptBuilderPort. Wraps getUCISPrompt — the prompt IP is constructed
 * here and bundled into the worker by esbuild, so it never leaves the server.
 * Config-only / stateless: safe to share across requests.
 */

import { getUCISPrompt } from '../../../web/lib/prompts/factory';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { EngineContext } from '../ports/ReasoningEnginePort';

export class PromptBuilder implements PromptBuilderPort {
  /**
   * Build the UCIS v5.1 system prompt from domain objects.
   */
  build(context: EngineContext): string {
    return getUCISPrompt({
      version: '5.1',
      metadata: {
        title: context.metadata.title,
        channelTitle: context.metadata.channelTitle,
        viewCount: String(context.metadata.viewCount ?? ''),
        likeCount: String(context.metadata.likeCount ?? ''),
        commentCount: String(context.metadata.commentCount ?? ''),
        publishedAt: context.metadata.publishedAt,
      },
      transcript: context.transcript || '',
      persona: (context.persona as any) || 'p1',
      timezone: context.timezone || 'UTC',
      duration: context.metadata.duration || 0,
    });
  }
}
