import { NextRequest } from 'next/server';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FULL_REPORT_TIERS } from '@/lib/config/report-tiers';

const getUser = vi.fn();
const mockSupabaseWithAuth = {
  auth: { getUser },
};

const maybeSingleUser = vi.fn();
const maybeSingleAnalysis = vi.fn();
const mockServiceClient = {
  from: vi.fn((table: string) => {
    if (table === 'users') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: maybeSingleUser,
          }),
        }),
      };
    }
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: maybeSingleAnalysis,
          }),
          maybeSingle: maybeSingleAnalysis,
        }),
      }),
    };
  }),
};

vi.mock('@/lib/supabase', () => ({
  getSupabaseClientWithAuth: vi.fn(() => Promise.resolve(mockSupabaseWithAuth)),
  getSupabaseServiceClient: vi.fn(() => mockServiceClient),
}));

vi.mock('@/lib/services/traffic', () => ({
  getUserTier: vi.fn().mockResolvedValue('pro'),
}));

vi.mock('@/lib/usage', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import { GET } from '../route';

describe('FULL_REPORT_TIERS — canonical tier vocabulary', () => {
  it('grants full-report export to every paid tier', () => {
    for (const tier of ['pro', 'max', 'enterprise'] as const) {
      expect(FULL_REPORT_TIERS.has(tier), `${tier} should be permitted`).toBe(true);
    }
  });

  it('is digest-only for light (product decision 2026-09-24)', () => {
    expect(FULL_REPORT_TIERS.has('light')).toBe(false);
  });

  it('denies free tier', () => {
    expect(FULL_REPORT_TIERS.has('free')).toBe(false);
  });
});

describe('GET /api/analyses/[id]/export — security & caching headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('strictly returns Cache-Control: private, no-store on successful PDF export', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-123' } } });
    maybeSingleUser.mockResolvedValue({ data: { role: 'user' }, error: null });
    maybeSingleAnalysis.mockResolvedValue({
      data: {
        id: 'a-123',
        title: 'Test Analysis',
        channel_title: 'Test Channel',
        created_at: new Date().toISOString(),
        analysis_markdown: '## DIMENSION 1: Strategic Intelligence\nValid content for testing export.',
      },
      error: null,
    });

    const req = new NextRequest('http://localhost/api/analyses/a-123/export?format=pdf&scope=summary');
    const res = await GET(req, { params: Promise.resolve({ id: 'a-123' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
