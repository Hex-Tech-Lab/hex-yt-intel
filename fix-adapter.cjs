const fs = require('fs');
let file = fs.readFileSync('web/lib/adapters/SupabaseTemporalGraphAdapter.ts', 'utf8');

file = file.replace(
  /import { getSupabaseServiceClient } from '@\/lib\/supabase';/,
  "import { getSupabaseServiceClient } from '@/lib/supabase';\nimport { hammingDistance } from '@/lib/utils/simhash';"
);

const resolverMethod = `  async resolveAnchorByHammingDistance(params: {
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
      results.sort((a, b) => a.dist - b.dist);
      return results.map(r => r.anchor);
    } catch (error) {
      Sentry.captureException(error, { tags: { method: 'resolveAnchorByHammingDistance' } });
      return [];
    }
  }

  async queryTemporalSubgraph`;

file = file.replace(/  async queryTemporalSubgraph/, resolverMethod);
fs.writeFileSync('web/lib/adapters/SupabaseTemporalGraphAdapter.ts', file);
