/**
 * Analysis Lifecycle Service
 * Handles background persistence, validation, and task orchestration
 */

import { randomUUID } from 'crypto';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { publishValidationTask } from '@/lib/qstash-client';
import { setAnalysisCache, generateCacheKey, type CachedAnalysisResult } from '@/lib/services/cache';
import { parseSSELine } from '@/lib/streaming/decoder';
import * as Sentry from '@sentry/nextjs';

export interface AnalysisContext {
  videoId: string;
  userId: string;
  metadata: any;
  transcript: string;
  persona: string;
  timezone: string;
  transcriptWarning?: string;
}

export class AnalysisLifecycleService {
  static async handleBackgroundTasks(
    context: AnalysisContext,
    processorStream: ReadableStream
  ) {
    const analysisId = randomUUID();
    const { videoId, userId, metadata, transcript } = context;

    try {
      // 1. Initial Database Record Creation
      const supabase = getSupabaseServiceClient();
      const insertPayload = {
        id: analysisId,
        video_id: videoId,
        user_id: userId,
        title: metadata.title,
        analysis_markdown: '',
        model_used: 'free-tier-waterfall',
        validation_report: {
          transcript_available: !!transcript,
          analysis_type: (transcript ? 'full' : 'metadata-only') as 'full' | 'metadata-only',
          warning: context.transcriptWarning,
        },
        validation_passed: false,
        created_at: new Date().toISOString(),
      };

      const { error: insertError } = await supabase.from('analyses').insert(insertPayload);
      if (insertError) throw insertError;

      // 2. Stream Consumption & Markdown Collection
      const reader = processorStream.getReader();
      const decoder = new TextDecoder();
      let markdown = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            const token = parseSSELine(buffer);
            if (token) markdown += token;
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const token = parseSSELine(line);
          if (token) markdown += token;
        }
      }

      // 3. Final Database Update
      const { error: updateError } = await supabase
        .from('analyses')
        .update({ analysis_markdown: markdown, updated_at: new Date().toISOString() })
        .eq('id', analysisId);
      if (updateError) throw updateError;

      // 4. Cache Update
      const cacheKey = generateCacheKey('free-tier-waterfall', transcript, '5.1');
      const cachedPayload: CachedAnalysisResult = {
        id: analysisId,
        video_id: videoId,
        title: metadata.title,
        analysis_markdown: markdown,
        validation_report: insertPayload.validation_report,
        model_used: 'free-tier-waterfall',
        created_at: insertPayload.created_at,
        cached_at: new Date().toISOString(),
      };
      await setAnalysisCache(cacheKey, cachedPayload);

      // 5. Async Validation Task
      if (transcript) {
        await publishValidationTask({
          videoId,
          markdown,
          filename: `${videoId}.md`,
          userId,
          analysisId,
          metadata: {
            title: metadata.title,
            channelTitle: metadata.channelTitle,
          },
        });
      }
    } catch (error) {
      Sentry.captureException(error, {
        tags: { operation: 'analysis-lifecycle' },
        contexts: { analysis: { analysisId, videoId, userId } },
      });
    }
  }
}
