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
        simhash_64: a.simhash64.toString(), // store as string in json/pg BIGINT mappings
        salient_claim: a.salientClaim,
        verbatim_anchor: a.verbatimAnchor
      }));
      
      const { error } = await service.from('analysis_simhash_anchors').insert(rows);
      if (error) throw error;
      return true;
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'storeSimHashAnchors' } });
      return false;
    }
  }

  async queryTemporalSubgraph(params: {
    analysisId: string;
    entityFilter?: string[];
  }): Promise<TemporalSubgraphNode[]> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service.rpc('get_temporal_subgraph', {
        p_analysis_id: params.analysisId,
        p_entity_filter: params.entityFilter || []
      });
      if (error) throw error;
      if (!data) return [];
      
      return data.map((row: any) => ({
        id: row.anchor_id,
        analysisId: params.analysisId,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        simhash64: BigInt(row.simhash_64),
        salientClaim: row.salient_claim,
        verbatimAnchor: row.verbatim_anchor,
        depth: row.depth
      }));
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'queryTemporalSubgraph' } });
      return [];
    }
  }

  async resolveAnchorByHammingDistance(params: {
    analysisId: string;
    targetSimHash: bigint;
    maxDistance: number;
  }): Promise<TemporalAnchor | null> {
    try {
      const service = getSupabaseServiceClient();
      // Fetch all for analysis and resolve in memory for now, 
      // though a custom postgres C extension would be optimal.
      const { data, error } = await service
        .from('analysis_simhash_anchors')
        .select('*')
        .eq('analysis_id', params.analysisId);
        
      if (error) throw error;
      if (!data || data.length === 0) return null;
      
      let bestAnchor: TemporalAnchor | null = null;
      let minDistance = params.maxDistance + 1;
      
      for (const row of data) {
        const hash = BigInt(row.simhash_64);
        const dist = hammingDistance(params.targetSimHash, hash);
        if (dist <= params.maxDistance && dist < minDistance) {
          minDistance = dist;
          bestAnchor = {
            id: row.id,
            analysisId: row.analysis_id,
            windowStart: row.window_start,
            windowEnd: row.window_end,
            simhash64: hash,
            salientClaim: row.salient_claim,
            verbatimAnchor: row.verbatim_anchor
          };
        }
      }
      return bestAnchor;
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'resolveAnchorByHammingDistance' } });
      return null;
    }
  }
}
