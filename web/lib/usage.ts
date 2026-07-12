import { getSupabaseServiceClient } from './supabase';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { USAGE_LOG_SCHEMA } from './usage/usage-log-schema';

export interface LogUsageParams {
  userId: string;
  action: string;
  metadata?: Record<string, unknown>;
}

export async function logUsage(params: LogUsageParams): Promise<void> {
  try {
    const supabase = getSupabaseServiceClient();

    const logEntry = {
      user_id: params.userId,
      action: params.action,
      metadata: params.metadata,
      created_at: new Date().toISOString(),
    };

    // Validate schema before insert
    const validated = USAGE_LOG_SCHEMA.parse(logEntry);

    await supabase.from('usage_logs').insert(validated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[logUsage]', { message: 'Schema validation failed', issues: error.issues });
      Sentry.captureException(error, { contexts: { layer: 'usage_log_validation' } });
    } else {
      console.error('[logUsage]', { message: 'Failed to log usage', error: error instanceof Error ? error.message : String(error) });
      Sentry.captureException(error, { contexts: { layer: 'usage_log_insert' } });
    }
  }
}
