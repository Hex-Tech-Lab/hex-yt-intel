import { getSupabaseServiceClient } from '@/lib/supabase';

/**
 * Phase C shadow-mode persistence (2026-10-08): stores the Epistemic
 * pipeline's grounded claims on the analysis row (columns from migration
 * 20261005020000). Deliberately leaves billing_status untouched -- shadow runs
 * never change the live analysis lifecycle. Throws on failure.
 */
export const SupabaseEpistemicAdapter = {
  async persistGroundedClaims(params: {
    analysisId: string;
    groundedClaims: unknown;
    unknowns: string[];
    degradedSensors: boolean;
  }): Promise<{ updated: boolean }> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from('analyses')
      .update({ grounded_claims: params.groundedClaims, unknowns: params.unknowns, degraded_sensors: params.degradedSensors })
      .eq('id', params.analysisId)
      .select('id');
    if (error) throw error;
    return { updated: Array.isArray(data) && data.length > 0 };
  },
};
