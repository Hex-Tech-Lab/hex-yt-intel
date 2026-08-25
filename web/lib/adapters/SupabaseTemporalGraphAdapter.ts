import type { TemporalKnowledgePort, TemporalAnchor, TemporalSubgraphNode } from '@/lib/ports/TemporalKnowledgePort';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { hammingDistance } from '@/lib/utils/simhash';
import * as Sentry from '@sentry/nextjs';

export class SupabaseTemporalGraphAdapter implements TemporalKnowledgePort {
  async storeSimHashAnchors(params: {
    analysisId: string;
    anchors: Omit<TemporalAnchor, 'id' | 'analysisId'>[];
  }): Promise<boolean> {
    try {
      const service = getSupabaseServiceClient();
      const rows = params.anchors.map(a => ({
        analysis_id: params.analysisId,
        window_start: a.windowStart,
        window_end: a.windowEnd,
        // Convert to signed 64-bit int string for Postgres BIGINT
        simhash_64: BigInt.asIntN(64, a.simhash64).toString(),
        salient_claim: a.salientClaim,
        verbatim_anchor: a.verbatimAnchor
      }));
      
      const { error } = await service
        .from('analysis_simhash_anchors')
        .upsert(rows, { onConflict: 'analysis_id,window_start' });
        
      if (error) throw error;
      return true;
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'storeSimHashAnchors' } });
      return false;
    }
  }

  async resolveAnchorByHammingDistance(params: {
    analysisId: string;
    queryHash: bigint;
    maxDistance?: number;
  }): Promise<TemporalAnchor[]> {
    try {
      const service = getSupabaseServiceClient();
      // Fetch all anchors for this analysis
      const { data, error } = await service
        .from('analysis_simhash_anchors')
        .select('*')
        .eq('analysis_id', params.analysisId);
        
      if (error) throw error;
      if (!data || data.length === 0) return [];
      
      const maxDist = params.maxDistance ?? 12;
      const results: { anchor: TemporalAnchor, dist: number }[] = [];
      
      for (const row of data) {
        const anchorHash = BigInt.asUintN(64, BigInt(row.simhash_64));
        const dist = hammingDistance(params.queryHash, anchorHash);
        if (dist <= maxDist) {
          results.push({
            anchor: {
              id: row.id,
              analysisId: params.analysisId,
              windowStart: row.window_start,
              windowEnd: row.window_end,
              simhash64: anchorHash,
              salientClaim: row.salient_claim,
              verbatimAnchor: row.verbatim_anchor
            },
            dist
          });
        }
      }
      
      // Sort by best match (lowest distance)
      results.sort((resultA, resultB) => resultA.dist - resultB.dist);
      return results.map(result => result.anchor);
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'resolveAnchorByHammingDistance' } });
      return [];
    }
  }

  async queryTemporalSubgraph(params: {
    analysisId: string;
  }): Promise<TemporalSubgraphNode[]> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service.rpc('get_temporal_subgraph', {
        p_analysis_id: params.analysisId
      });
      if (error) throw error;
      if (!data) return [];
      
      return data.map((row: any) => ({
        id: row.anchor_id,
        analysisId: params.analysisId,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        // Convert back to unsigned 64-bit bigint
        simhash64: BigInt.asUintN(64, BigInt(row.simhash_64)),
        salientClaim: row.salient_claim,
        verbatimAnchor: row.verbatim_anchor,
        depth: row.depth
      }));
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'queryTemporalSubgraph' } });
      return [];
    }
  }
}
