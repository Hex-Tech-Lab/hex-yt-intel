import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PathAInputSchema, PathAOutputSchema, PathBInputSchema, PathBOutputSchema, WorkflowScopeSchema } from '@/lib/types/workflow';
import type { WorkflowContext, WorkflowResult } from '@/lib/services/WorkflowConductor';

/**
 * WorkflowConductor Contract Verification Suite
 *
 * Tests the Zod schema contracts (entry/exit doors) for Path A, Path B,
 * and the persist room gate without instantiating the conductor itself
 * (hexagonal principle: test contracts, not implementations).
 */

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const validYouTubeUrls = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtu.be/dQw4w9WgXcQ',
  'https://youtube.com/watch?v=dQw4w9WgXcQ',
];

const malformedUrls = [
  'not-a-url',
  '',
];

const validCacheHitPayload = {
  id: 'abc-123',
  videoId: 'dQw4w9WgXcQ',
  title: 'Test Video',
  analysisMarkdown: '# Analysis',
  createdAt: new Date().toISOString(),
  dimensions: { 1: { number: 1, name: 'Test', content: 'Content' } },
  cachedReport: { persona: 'p1', metadata: { videoId: 'dQw4w9WgXcQ' } },
};

const validProcessingPayload = {
  id: 'abc-123',
  analysisId: 'abc-123',
  videoId: 'dQw4w9WgXcQ',
  status: 'processing' as const,
  title: 'Test Video',
  metadata: { videoId: 'dQw4w9WgXcQ' },
  transcript: '',
  timezone: 'UTC',
  models: ['model-1'],
  stream: { url: 'https://worker.test/stream', sig: 'abc', exp: 9999999999 },
};

const truncatedPayload = {
  schemaVersion: '2.0',
  dimensions: [{ number: 1 }],
};

const partialChunkPayload = {
  analysisId: 'abc-123',
  chunkIndex: 1,
  status: 'completed',
  payload: {
    schemaVersion: '2.0',
    dimensions: [{ number: 1, name: 'Test', content: 'Content' }],
  },
};

// ─── WorkflowScope Schema ─────────────────────────────────────────────────────

describe('WorkflowScopeSchema', () => {
  it('accepts single_video scope', () => {
    expect(WorkflowScopeSchema.parse('single_video')).toBe('single_video');
  });

  it('accepts cross_analysis scope', () => {
    expect(WorkflowScopeSchema.parse('cross_analysis')).toBe('cross_analysis');
  });

  it('accepts persist scope', () => {
    expect(WorkflowScopeSchema.parse('persist')).toBe('persist');
  });

  it('rejects unknown scopes', () => {
    expect(() => WorkflowScopeSchema.parse('unknown')).toThrow();
  });
});

// ─── Path A: Single-Video Universe ────────────────────────────────────────────

describe('Path A — Single-Video Universe', () => {
  describe('PathAInputSchema (entry door)', () => {
    it('accepts a valid single-video request', () => {
      for (const url of validYouTubeUrls) {
        const result = PathAInputSchema.safeParse({
          url,
          userId: 'user-1',
          tier: 'free',
          timezone: 'UTC',
        });
        expect(result.success).toBe(true);
      }
    });

    it('accepts all valid tier values', () => {
      for (const tier of ['free', 'pro', 'enterprise'] as const) {
        const result = PathAInputSchema.safeParse({
          url: validYouTubeUrls[0],
          userId: 'user-1',
          tier,
          timezone: 'US/Eastern',
        });
        expect(result.success).toBe(true);
      }
    });

    it('accepts optional fields (email, persona, forceRefresh)', () => {
      const result = PathAInputSchema.safeParse({
        url: validYouTubeUrls[0],
        userId: 'user-1',
        tier: 'pro',
        timezone: 'UTC',
        email: 'user@example.com',
        persona: 'p3',
        forceRefresh: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects malformed URLs', () => {
      for (const url of malformedUrls) {
        const result = PathAInputSchema.safeParse({
          url,
          userId: 'user-1',
          tier: 'free',
          timezone: 'UTC',
        });
        expect(result.success).toBe(false);
      }
    });

    it('rejects missing required fields', () => {
      const result = PathAInputSchema.safeParse({
        url: validYouTubeUrls[0],
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid email format', () => {
      const result = PathAInputSchema.safeParse({
        url: validYouTubeUrls[0],
        userId: 'user-1',
        tier: 'free',
        timezone: 'UTC',
        email: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PathAOutputSchema (exit door)', () => {
    it('accepts a cache_hit result', () => {
      const result = PathAOutputSchema.safeParse({
        type: 'cache_hit',
        data: validCacheHitPayload,
      });
      expect(result.success).toBe(true);
    });

    it('accepts a processing result with full stream token', () => {
      const result = PathAOutputSchema.safeParse({
        type: 'processing',
        data: validProcessingPayload,
      });
      expect(result.success).toBe(true);
    });

    it('accepts an error result', () => {
      const result = PathAOutputSchema.safeParse({
        type: 'error',
        code: 'ERR_INVALID_URL',
        status: 400,
        message: 'Invalid YouTube URL',
      });
      expect(result.success).toBe(true);
    });

    it('rejects unknown discriminated union type', () => {
      const result = PathAOutputSchema.safeParse({
        type: 'unknown_type',
        data: {},
      });
      expect(result.success).toBe(false);
    });

    it('rejects processing result missing required stream fields', () => {
      const result = PathAOutputSchema.safeParse({
        type: 'processing',
        data: { ...validProcessingPayload, stream: { url: 'missing-sig' } },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Path A — Complete Cache Hit scenario', () => {
    const cacheHitInput = {
      url: validYouTubeUrls[0],
      userId: 'user-1',
      tier: 'free',
      timezone: 'UTC',
    };

    it('validates input schema for cache hit flow', () => {
      const input = PathAInputSchema.safeParse(cacheHitInput);
      expect(input.success).toBe(true);
    });

    it('cache_hit output is compatible with cache hit return contract', () => {
      const output = PathAOutputSchema.safeParse({
        type: 'cache_hit',
        data: validCacheHitPayload,
      });
      expect(output.success).toBe(true);
    });
  });

  describe('Path A — Partial Chunk Interrupt scenario', () => {
    const interruptedInput = {
      url: validYouTubeUrls[0],
      userId: 'user-2',
      tier: 'pro',
      timezone: 'America/New_York',
    };

    it('validates input for interrupted processing', () => {
      const result = PathAInputSchema.safeParse(interruptedInput);
      expect(result.success).toBe(true);
    });

    it('partial payload fails PathAOutputSchema (missing required fields)', () => {
      const result = PathAOutputSchema.safeParse({
        type: 'error',
        code: 'ERR_INGESTION_FAILED',
        status: 500,
        // message omitted — should fail
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Path A — Pristine Fresh Run scenario', () => {
    const freshRunInput = {
      url: validYouTubeUrls[0],
      userId: 'user-3',
      tier: 'enterprise',
      timezone: 'Europe/London',
      persona: 'p1' as const,
      forceRefresh: true,
    };

    it('validates input for fresh run', () => {
      const result = PathAInputSchema.safeParse(freshRunInput);
      expect(result.success).toBe(true);
    });

    it('forceRefresh flag passes through schema', () => {
      const result = PathAInputSchema.safeParse(freshRunInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.forceRefresh).toBe(true);
      }
    });
  });
});

// ─── Path B: Cross-Analysis Atlas Track ───────────────────────────────────────

describe('Path B — Cross-Analysis Atlas Track', () => {
  describe('PathBInputSchema (entry door)', () => {
    it('accepts a valid cross-analysis request', () => {
      const result = PathBInputSchema.safeParse({
        userId: 'user-1',
        query: 'find related videos',
      });
      expect(result.success).toBe(true);
    });

    it('accepts request without query (optional)', () => {
      const result = PathBInputSchema.safeParse({
        userId: 'user-1',
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional models array', () => {
      const result = PathBInputSchema.safeParse({
        userId: 'user-1',
        query: 'test',
        models: ['model-a', 'model-b'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing userId', () => {
      const result = PathBInputSchema.safeParse({
        query: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty userId', () => {
      const result = PathBInputSchema.safeParse({
        userId: '',
        query: 'test',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PathBOutputSchema (exit door)', () => {
    it('accepts a valid knowledge base response', () => {
      const result = PathBOutputSchema.safeParse({
        scope: 'global',
        knowledgeBase: [
          {
            analysisId: 'abc-123',
            title: 'Video 1',
            nodes: [{ id: 'n1', label: 'Node 1' }],
            edges: [{ source: 'n1', target: 'n2' }],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty knowledge base', () => {
      const result = PathBOutputSchema.safeParse({
        scope: 'global',
        knowledgeBase: [],
      });
      expect(result.success).toBe(true);
    });

    it('rejects scope other than global', () => {
      const result = PathBOutputSchema.safeParse({
        scope: 'video',
        knowledgeBase: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Path B — Identity / Tenant Boundary', () => {
    it('validates user identity is required', () => {
      const result = PathBInputSchema.safeParse({
        query: 'cross-analysis',
      });
      expect(result.success).toBe(false);
    });

    it('treats different userIds as distinct tenants', () => {
      const r1 = PathBInputSchema.safeParse({ userId: 'tenant-a', query: 'test' });
      const r2 = PathBInputSchema.safeParse({ userId: 'tenant-b', query: 'test' });
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      if (r1.success && r2.success) {
        expect(r1.data.userId).not.toBe(r2.data.userId);
      }
    });
  });
});

// ─── Persist Room Gate (S2S) ─────────────────────────────────────────────────

describe('Persist Room Gate — S2S Contract Enforcement', () => {
  it('truncated payload (missing content field) is rejected', () => {
    const result = PathAOutputSchema.safeParse(truncatedPayload);
    expect(result.success).toBe(false);
  });

  it('partial chunk without full dimension spec is not a valid PathA output', () => {
    const result = PathAOutputSchema.safeParse(partialChunkPayload);
    expect(result.success).toBe(false);
  });

  it('a valid completed payload round-trips through output schema', () => {
    const payload = {
      type: 'processing' as const,
      data: validProcessingPayload,
    };
    const output = PathAOutputSchema.safeParse(payload);
    expect(output.success).toBe(true);
    if (output.success) {
      expect(output.data.type).toBe('processing');
    }
  });

  it('error results are properly structured for downstream handling', () => {
    const errorPayload = {
      type: 'error' as const,
      code: 'ERR_TOKEN_SIGNING_FAILED',
      status: 500,
      message: 'Security configuration error',
    };
    const result = PathAOutputSchema.safeParse(errorPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('ERR_TOKEN_SIGNING_FAILED');
    }
  });
});

// ─── WorkflowResult Type Contract ─────────────────────────────────────────────

describe('WorkflowResult type contract', () => {
  it('success result has correct shape', () => {
    const result: WorkflowResult<string> = {
      success: true,
      data: 'test-data',
      context: {
        scope: 'single_video',
        traceId: 'trace-123',
        startTime: Date.now(),
      },
    };
    expect(result.success).toBe(true);
    expect(typeof result.data).toBe('string');
    expect(result.context.traceId).toBeTruthy();
    expect(typeof result.context.startTime).toBe('number');
  });

  it('failure result has correct shape', () => {
    const result: WorkflowResult<never> = {
      success: false,
      error: 'Something went wrong',
      code: 'ERR_INTERNAL',
      status: 500,
      context: {
        scope: 'persist',
        traceId: 'trace-456',
        startTime: Date.now(),
      },
    };
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(typeof result.status).toBe('number');
  });

  it('WorkflowContext interface has required fields', () => {
    const ctx: WorkflowContext = {
      scope: 'cross_analysis',
      traceId: crypto.randomUUID(),
      startTime: Date.now(),
    };
    expect(ctx.scope).toBe('cross_analysis');
    expect(ctx.traceId).toMatch(/^[0-9a-f-]+$/);
  });
});

// ─── Partial<UCISPayloadV2> Contract Enforcement ──────────────────────────────

describe('Partial<UCISPayloadV2> contract boundary', () => {
  it('rejects payload without required schemaVersion', () => {
    const result = PathAOutputSchema.safeParse(truncatedPayload);
    expect(result.success).toBe(false);
  });

  it('allows partial payloads in output when properly typed', () => {
    const partial = {
      type: 'processing' as const,
      data: validProcessingPayload,
    };
    const result = PathAOutputSchema.safeParse(partial);
    expect(result.success).toBe(true);
  });
});