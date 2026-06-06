import { getSupabaseServiceClient } from './supabase';

export interface LogUsageParams {
  userId: string;
  action: string;
  metadata?: Record<string, unknown>;
}

export async function logUsage(params: LogUsageParams): Promise<void> {
  try {
    const supabase = getSupabaseServiceClient();

    await supabase.from('usage_logs').insert({
      user_id: params.userId,
      action: params.action,
      metadata: params.metadata,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[logUsage] Failed to log usage:', error);
  }
}
