import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { getSupabaseServiceClient } from './supabase';
import { USAGE_LOG_SCHEMA } from './usage/usage-log-schema';

export interface LogUsageParams {
  userId: string;
  action: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log usage event with schema validation.
 * Returns true on success, false on validation or insert failure.
 * All errors are logged and captured in Sentry.
 */

export async function logUsage(params: LogUsageParams): Promise<boolean> {
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

    const { error: insertError } = await supabase.from('usage_logs').insert(validated);
    if (insertError) {
      console.error('[logUsage]', { message: 'Failed to insert usage log', error: insertError.message });
      Sentry.captureException(new Error(insertError.message), { contexts: { usage: { layer: 'usage_log_insert' } } });
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[logUsage]', { message: 'Schema validation failed', issues: error.issues });
      Sentry.captureException(error, { contexts: { usage: { layer: 'usage_log_validation' } } });
    } else {
      console.error('[logUsage]', { message: 'Failed to log usage', error: error instanceof Error ? error.message : String(error) });
      Sentry.captureException(error, { contexts: { usage: { layer: 'usage_log_insert' } } });
    }
    return false;
  }
}
