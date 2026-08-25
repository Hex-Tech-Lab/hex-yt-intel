import { describe, it, expect, vi } from 'vitest';
import { SupabaseTemporalGraphAdapter } from '../SupabaseTemporalGraphAdapter';

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'anc-1',
              analysis_id: 'ana-1',
              window_start: 0,
              window_end: 30,
              simhash_64: '1234567890',
              salient_claim: 'Claim',
              verbatim_anchor: 'Anchor'
            }
          ],
          error: null
        })
      }))
    })),
    rpc: vi.fn().mockResolvedValue({
      data: [
        {
          anchor_id: 'anc-1',
          window_start: 0,
          window_end: 30,
          simhash_64: '1234567890',
          salient_claim: 'Claim',
          verbatim_anchor: 'Anchor',
          depth: 0
        }
      ],
      error: null
    })
  }))
}));

describe('SupabaseTemporalGraphAdapter', () => {
  const adapter = new SupabaseTemporalGraphAdapter();

  it('stores simhash anchors', async () => {
    const res = await adapter.storeSimHashAnchors({
      analysisId: 'ana-1',
      anchors: [{ windowStart: 0, windowEnd: 30, simhash64: 12345n, salientClaim: null, verbatimAnchor: null }]
    });
    expect(res).toBe(true);
  });

  it('queries temporal subgraph', async () => {
    const res = await adapter.queryTemporalSubgraph({ analysisId: 'ana-1' });
    expect(res).toHaveLength(1);
    expect(res[0]!.depth).toBe(0);
    expect(res[0]!.simhash64).toBe(1234567890n);
  });

  it('resolves anchor by hamming distance', async () => {
    const res = await adapter.resolveAnchorByHammingDistance({
      analysisId: 'ana-1',
      targetSimHash: 1234567890n,
      maxDistance: 5
    });
    expect(res).not.toBeNull();
    expect(res!.id).toBe('anc-1');
  });
});
