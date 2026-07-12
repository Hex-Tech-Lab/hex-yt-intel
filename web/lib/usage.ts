import { getSupabaseServiceClient } from './supabase';
import { z } from 'zod';
import { UsageLogSchema } from './usage/usage-log-schema';

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
    const validated = UsageLogSchema.parse(logEntry);

    await supabase.from('usage_logs').insert(validated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[logUsage] Schema validation failed:', error.issues);
    } else {
      console.error('[logUsage] Failed to log usage:', error);
    }
  }
}
