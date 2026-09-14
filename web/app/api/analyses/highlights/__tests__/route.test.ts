/**
 * Wire-contract test for GET /api/analyses/highlights (RCA 2026-09-13, live
 * video gKgWYFOhZx0).
 *
 * PR #281's route rewrite silently renamed the response keys
 * verbatimExcerpt/takeawayIdx to their snake_case DB column names
 * (verbatim_excerpt/takeaway_idx), while every dashboard consumer
 * (HighlightsScrubber, HighlightsTrack, useHighlightTicker) reads the
 * camelCase keys this endpoint emitted pre-#281. With no mapping between
 * res.json() and render, `verbatimExcerpt` was ALWAYS undefined — so every
 * keypoint that HAS a verbatim excerpt stored in analysis_highlights
 * rendered the "No verbatim transcript excerpt is stored" fallback plus the
 * SUMMARIZED badge (all 10 rows of the live incident had non-empty
 * verbatim_excerpt values, 434–1267 chars). The share-page path never broke
 * because SupabaseAnalysisAdapter.findHighlightsForAnalysis maps to
 * camelCase server-side.
 *
 * Pinned here at the route boundary with DB rows in their REAL snake_case
 * shape: the response MUST carry camelCase verbatimExcerpt/takeawayIdx.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSupabaseClientWithAuth = vi.hoisted(() => vi.fn());
const getRegistrySettings = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({ getSupabaseClientWithAuth }));
vi.mock('@/lib/adapters/SupabaseSettingsAdapter', () => ({
  SupabaseSettingsAdapter: { getRegistrySettings },
}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { GET } from '@/app/api/analyses/highlights/route';

// Real analysis_highlights column shape (supabase/migrations +
// live-verified 2026-09-13): snake_case keys, including verbatim_excerpt.
const DB_ROWS = [
  {
    idx: 0,
    start_seconds: 0.08,
    end_seconds: 20,
    label: 'Intro explains matching platform choice to brand constraints.',
    verbatim_excerpt: "If you're building an influencer program, don't waste weeks testing platforms.",
    takeaway_idx: 0,
  },
  {
    idx: 1,
    start_seconds: 877.199,
    end_seconds: 937,
    label: 'Impact.com combines affiliate, influencer, gifting reporting with streamlined payouts.',
    verbatim_excerpt: 'Five. Impact.com. Impact is a partnership platform that blends affiliate, influencer...',
    takeaway_idx: 5,
  },
];

function mockSupabaseChain(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  };
  const client = {
    from: vi.fn().mockReturnValue(chain),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
  };
  getSupabaseClientWithAuth.mockResolvedValue(client);
  return { client, chain };
}

const getRequest = (): NextRequest =>
  new NextRequest('http://localhost/api/analyses/highlights?analysisId=550e8400-e29b-41d4-a716-446655440000');

describe('GET /api/analyses/highlights (camelCase wire contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRegistrySettings.mockResolvedValue({
      'highlights.segmentDurationSeconds': 10,
      'highlights.contextLeadSeconds': 2,
      'highlights.minSegmentDurationSeconds': 5,
      'highlights.maxSegmentDurationSeconds': 60,
    });
  });

  it('maps DB snake_case verbatim_excerpt/takeaway_idx onto camelCase response keys', async () => {
    mockSupabaseChain(DB_ROWS);

    const res = await GET(getRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.highlights).toHaveLength(2);
    for (const h of body.highlights) {
      expect(h.verbatimExcerpt).toEqual(expect.any(String));
      expect(h.verbatimExcerpt.length).toBeGreaterThan(0);
      expect(h.takeawayIdx).toEqual(expect.any(Number));
      // The regression's exact shape must be gone: no snake_case keys.
      expect(h.verbatim_excerpt).toBeUndefined();
      expect(h.takeaway_idx).toBeUndefined();
    }
    expect(body.highlights[1].verbatimExcerpt).toContain('Impact.com');
    expect(body.highlights[1].takeawayIdx).toBe(5);
  });

  it('a null verbatim_excerpt stays null (legacy rows keep the summarized fallback path)', async () => {
    mockSupabaseChain([{ ...DB_ROWS[0], verbatim_excerpt: null, takeaway_idx: null }]);

    const res = await GET(getRequest());
    const body = await res.json();
    expect(body.highlights[0].verbatimExcerpt).toBeNull();
    expect(body.highlights[0].takeawayIdx).toBeNull();
  });

  it('schema validation does not drop the excerpt (boundary keeps verbatimExcerpt through HighlightsResponseSchema)', async () => {
    mockSupabaseChain(DB_ROWS);

    const res = await GET(getRequest());
    const body = await res.json();
    // If the schema stripped these keys the scrubber would regress to the
    // fallback tooltip for every keypoint even with the route mapping fixed.
    expect(body.highlights[0]).toMatchObject({
      verbatimExcerpt: expect.any(String),
      takeawayIdx: 0,
      label: DB_ROWS[0].label,
    });
  });

  it('returns 401 when unauthenticated', async () => {
    mockSupabaseChain([]);
    getSupabaseClientWithAuth.mockResolvedValue({
      from: vi.fn(),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no session' } }) },
    });

    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });
});
