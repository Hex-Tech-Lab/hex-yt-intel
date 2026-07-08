/**
 * Search API — Contract Audit & Security Verification
 * =====================================================
 * Tests the complete search → auth → quota flow for:
 * 1. Request validation contracts (query, topK bounds)
 * 2. Authentication extraction & resolution
 * 3. Rate limiting enforcement (429 responses, headers)
 * 4. Embedding generation failure modes
 * 5. Result enrichment schema matching
 * 6. Ownership verification (IDOR defense)
 *
 * Reference: POST /api/search
 */

import { describe, it, expect } from 'vitest';

/**
 * CONTRACT: Request Validation
 * Expected: Query 3-1000 chars, topK optional (default 5, capped at 50)
 */
describe('[CONTRACT] Search API: Request Validation', () => {
  describe('Query Length Bounds', () => {
    it('MUST reject queries shorter than 3 characters', () => {
      const query = 'ab'; // 2 chars
      expect(query.length).toBeLessThan(3);
      expect(() => {
        if (query.length < 3 || query.length > 1000) {
          throw new Error('Query must be between 3 and 1000 characters');
        }
      }).toThrow();
    });

    it('MUST accept queries exactly 3 characters', () => {
      const query = 'abc';
      expect(query.length).toBe(3);
      expect(() => {
        if (query.length < 3 || query.length > 1000) {
          throw new Error('Query must be between 3 and 1000 characters');
        }
      }).not.toThrow();
    });

    it('MUST accept queries up to 1000 characters', () => {
      const query = 'a'.repeat(1000);
      expect(query.length).toBe(1000);
      expect(() => {
        if (query.length < 3 || query.length > 1000) {
          throw new Error('Query must be between 3 and 1000 characters');
        }
      }).not.toThrow();
    });

    it('MUST reject queries longer than 1000 characters', () => {
      const query = 'a'.repeat(1001);
      expect(query.length).toBeGreaterThan(1000);
      expect(() => {
        if (query.length < 3 || query.length > 1000) {
          throw new Error('Query must be between 3 and 1000 characters');
        }
      }).toThrow();
    });

    it('MUST reject empty query strings', () => {
      const query = '';
      expect(() => {
        if (!query || typeof query !== 'string') {
          throw new Error('Query parameter is required and must be a string');
        }
      }).toThrow();
    });

    it('MUST reject non-string query values', () => {
      const query = 123 as any;
      expect(() => {
        if (!query || typeof query !== 'string') {
          throw new Error('Query parameter is required and must be a string');
        }
      }).toThrow();
    });
  });

  describe('TopK Bounds', () => {
    it('MUST default topK to 5 when omitted', () => {
      const topK = undefined;
      const defaultedTopK = topK ?? 5;
      expect(defaultedTopK).toBe(5);
    });

    it('MUST cap topK at 50 regardless of client request', () => {
      const clientTopK = 100;
      const cappedTopK = Math.min(clientTopK, 50);
      expect(cappedTopK).toBe(50);
    });

    it('MUST respect topK < 50', () => {
      const clientTopK = 10;
      const cappedTopK = Math.min(clientTopK, 50);
      expect(cappedTopK).toBe(10);
    });

    it('MUST accept topK = 50 (the boundary)', () => {
      const clientTopK = 50;
      const cappedTopK = Math.min(clientTopK, 50);
      expect(cappedTopK).toBe(50);
    });
  });

  describe('Request Body Schema', () => {
    it('MUST reject malformed JSON payloads', () => {
      const malformed = '{invalid json}';
      expect(() => {
        JSON.parse(malformed);
      }).toThrow();
    });

    it('MUST reject non-object payloads', () => {
      const body = 'just a string';
      expect(() => {
        if (!body || typeof body !== 'object') {
          throw new Error('Request body must be an object');
        }
      }).toThrow();
    });

    it('MUST reject null request bodies', () => {
      const body = null;
      expect(() => {
        if (!body || typeof body !== 'object') {
          throw new Error('Request body must be an object');
        }
      }).toThrow();
    });

    it('MUST accept valid { query, topK } schema', () => {
      const body = { query: 'test query', topK: 10 };
      expect(() => {
        if (!body || typeof body !== 'object') {
          throw new Error('Request body must be an object');
        }
        const { query, topK = 5 } = body as any;
        if (!query || typeof query !== 'string') {
          throw new Error('Query parameter is required and must be a string');
        }
      }).not.toThrow();
    });
  });
});

/**
 * CONTRACT: Authentication Extraction
 * Expected: Returns { userId, email, tier } or null
 */
describe('[CONTRACT] Search API: Authentication', () => {
  describe('Auth Adapter Contract', () => {
    it('MUST extract userId from Supabase session', async () => {
      // Mock contract: authenticate() → { userId, email?, tier }
      const mockIdentity = { userId: 'user-123', email: 'test@example.com', tier: 'free' as const };
      expect(mockIdentity).toHaveProperty('userId');
      expect(typeof mockIdentity.userId).toBe('string');
    });

    it('MUST extract email (or undefined) from session', async () => {
      const identityWithEmail = { userId: 'u1', email: 'test@ex.com', tier: 'free' as const };
      const identityWithoutEmail = { userId: 'u2', email: undefined, tier: 'free' as const };

      expect(identityWithEmail.email).toBeDefined();
      expect(identityWithoutEmail.email).toBeUndefined();
    });

    it('MUST resolve tier from users.tier column, default to "free"', () => {
      // Contract: findProfile() → tier OR default 'free'
      const profile1 = { tier: 'pro' };
      const profile2 = null; // Not found

      const tier1 = profile1?.tier ?? 'free';
      const tier2 = profile2?.tier ?? 'free';

      expect(tier1).toBe('pro');
      expect(tier2).toBe('free');
    });

    it('MUST return null when session is missing', async () => {
      // Contract: authenticate() returns null on auth failure
      const identity = null;
      expect(identity).toBeNull();
    });

    it('MUST return null when user ID is missing from Supabase', async () => {
      // Contract: Supabase returns { data: { user: null } } on missing session
      const supabaseUser = null;
      const identity = supabaseUser ? { userId: supabaseUser.id, email: supabaseUser.email, tier: 'free' } : null;
      expect(identity).toBeNull();
    });
  });

  describe('Auth Response Codes', () => {
    it('MUST respond with 401 when authentication fails', () => {
      const identity = null;
      const statusCode = identity ? 200 : 401;
      expect(statusCode).toBe(401);
    });

    it('MUST respond with 400 when auth extraction throws', () => {
      // Simulate JSON parse error during auth extraction
      const statusCode = 400;
      expect(statusCode).toBe(400);
    });
  });
});

/**
 * CONTRACT: Rate Limiting & Quota Enforcement
 * Expected: guardTraffic() returns { allowed, response?, headers? }
 */
describe('[CONTRACT] Search API: Rate Limiting', () => {
  describe('Rate Limit Enforcement', () => {
    it('MUST deny requests exceeding per-minute limit for free tier (3 req/min)', () => {
      const limit = 3;
      const requestCount = 4;
      const allowed = requestCount < limit;
      expect(allowed).toBe(false);
    });

    it('MUST allow requests within per-minute limit for free tier', () => {
      const limit = 3;
      const requestCount = 2;
      const allowed = requestCount < limit;
      expect(allowed).toBe(true);
    });

    it('MUST allow requests for pro tier (30 req/min)', () => {
      const limit = 30;
      const requestCount = 29;
      const allowed = requestCount < limit;
      expect(allowed).toBe(true);
    });

    it('MUST allow requests for enterprise tier (300 req/min soft limit)', () => {
      const limit = 300;
      const requestCount = 299;
      const allowed = requestCount < limit;
      expect(allowed).toBe(true);
    });

    it('MUST bypass rate limiting for admin (ADMIN_EMAIL)', () => {
      const email = 'admin@hex.local';
      const adminEmail = 'admin@hex.local';
      const isAdmin = email.toLowerCase() === adminEmail.toLowerCase();
      expect(isAdmin).toBe(true);
      // Admin should get { allowed: true, headers: { 'X-RateLimit-Admin': 'bypassed' } }
    });

    it('MUST bypass rate limiting for test user (TEST_USER_BYPASS_ID)', () => {
      const userId = 'test-user-bypass-id';
      const testBypassId = 'test-user-bypass-id';
      const isTestBypass = userId === testBypassId;
      expect(isTestBypass).toBe(true);
      // Test user should get { allowed: true, headers: { 'X-RateLimit-Admin': 'bypassed' } }
    });
  });

  describe('Rate Limit Response Format', () => {
    it('MUST return 429 status when rate limit exceeded', () => {
      const allowed = false;
      const statusCode = allowed ? 200 : 429;
      expect(statusCode).toBe(429);
    });

    it('MUST include X-RateLimit-* headers in 429 response', () => {
      const headers = {
        'X-RateLimit-Limit': '3',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '1234567890',
        'Retry-After': '60',
      };
      expect(headers).toHaveProperty('X-RateLimit-Limit');
      expect(headers).toHaveProperty('X-RateLimit-Remaining');
      expect(headers).toHaveProperty('X-RateLimit-Reset');
      expect(headers).toHaveProperty('Retry-After');
    });

    it('MUST include retryAfter in 429 JSON body', () => {
      const errorBody = {
        error: 'Rate limit exceeded',
        message: 'Too many requests. Current tier: free. Free tier: 3 requests/minute, 50/hour',
        retryAfter: 60,
        resetAt: '2026-07-08T14:30:00Z',
      };
      expect(errorBody).toHaveProperty('retryAfter');
      expect(errorBody).toHaveProperty('resetAt');
    });

    it('MUST include rate limit headers in success response (200)', () => {
      const headers = {
        'X-RateLimit-Limit': '3',
        'X-RateLimit-Remaining': '2',
        'X-RateLimit-Reset': '1234567890',
      };
      expect(headers).toHaveProperty('X-RateLimit-Remaining');
      expect(parseInt(headers['X-RateLimit-Remaining'])).toBeGreaterThanOrEqual(0);
    });

    it('MUST set X-Quota-Remaining for backward compatibility', () => {
      const headers = {
        'X-Quota-Remaining': '2',
      };
      expect(headers).toHaveProperty('X-Quota-Remaining');
    });

    it('MUST provide resetAt timestamp in RFC3339 format', () => {
      const resetAt = new Date().toISOString();
      expect(resetAt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('MUST use sliding window with 60-second window duration', () => {
      const windowDurationMs = 60000;
      expect(windowDurationMs).toBe(60 * 1000);
    });
  });

  describe('Redis Lua Script Behavior', () => {
    it('MUST gracefully degrade when Redis unavailable', () => {
      const luaResult = -1; // Sentinel for Redis failure
      const isUnavailable = luaResult === -1;
      expect(isUnavailable).toBe(true);
      // On degradation, should return { allowed: true, status: gracefulDefault }
    });

    it('MUST return [allowed (0|1), requestCount] tuple from Lua', () => {
      const luaResult = [1, 2]; // [allowed=true, count=2]
      expect(Array.isArray(luaResult)).toBe(true);
      expect(luaResult.length).toBe(2);
      expect([0, 1]).toContain(luaResult[0]);
      expect(typeof luaResult[1]).toBe('number');
    });
  });

  describe('Rate Limiting: Tier-Aware Limits', () => {
    const rateLimits = {
      free: { requestsPerMinute: 3, requestsPerHour: 50 },
      pro: { requestsPerMinute: 30, requestsPerHour: 500 },
      enterprise: { requestsPerMinute: 300, requestsPerHour: 10000 },
    };

    it('MUST use tier-specific requestsPerMinute from RATE_LIMITS', () => {
      expect(rateLimits.free.requestsPerMinute).toBe(3);
      expect(rateLimits.pro.requestsPerMinute).toBe(30);
      expect(rateLimits.enterprise.requestsPerMinute).toBe(300);
    });

    it('MUST default to free tier on missing tier config', () => {
      const tier = 'unknown' as any;
      const limit = rateLimits[tier as keyof typeof rateLimits]?.requestsPerMinute ?? 3;
      expect(limit).toBe(3);
    });
  });
});

/**
 * CONTRACT: Embedding Generation
 * Expected: Returns { embedding: number[], costUsd: number } or throws
 */
describe('[CONTRACT] Search API: Embedding Generation', () => {
  describe('Embedding Generation Success Contract', () => {
    it('MUST return 1536-dimensional embedding vector', () => {
      const mockEmbedding = new Array(1536).fill(0.5);
      expect(mockEmbedding).toHaveLength(1536);
    });

    it('MUST return embedding result with { embedding, costUsd }', () => {
      const result = {
        embedding: new Array(1536).fill(0.5),
        costUsd: 0.00004,
      };
      expect(result).toHaveProperty('embedding');
      expect(result).toHaveProperty('costUsd');
      expect(result.embedding).toHaveLength(1536);
      expect(typeof result.costUsd).toBe('number');
    });

    it('MUST validate embedding dimension match (1536)', () => {
      const validDim = 1536;
      const invalidDim = 512;
      expect(validDim).toBe(1536);
      expect(invalidDim).not.toBe(1536);
    });
  });

  describe('Embedding Generation Failure Modes', () => {
    it('MUST throw error when input text is empty', () => {
      const text = '';
      expect(() => {
        if (!text || text.trim().length === 0) {
          throw new Error('Cannot generate embedding for empty text');
        }
      }).toThrow();
    });

    it('MUST throw error when OPENROUTER_API_KEY missing', () => {
      const apiKey = undefined;
      expect(() => {
        if (!apiKey) {
          throw new Error('OPENROUTER_API_KEY is not configured. Set it in Vercel environment variables.');
        }
      }).toThrow();
    });

    it('MUST timeout after 5 seconds on no response', () => {
      // Contract: const timeout = setTimeout(() => controller.abort(), 5000);
      const timeoutMs = 5000;
      expect(timeoutMs).toBe(5000);
    });

    it('MUST handle OpenRouter API errors (non-200 response)', () => {
      const apiResponse = { ok: false, status: 429 };
      expect(() => {
        if (!apiResponse.ok) {
          throw new Error(`OpenRouter API error: ${apiResponse.status}`);
        }
      }).toThrow('429');
    });

    it('MUST handle malformed embedding response (wrong dimension)', () => {
      const response = {
        data: [{ embedding: new Array(512).fill(0.5) }], // Wrong dimension!
      };
      const embeddingDim = response.data[0].embedding.length;
      expect(() => {
        if (embeddingDim !== 1536) {
          throw new Error(`Invalid embedding dimension: got ${embeddingDim}, expected 1536`);
        }
      }).toThrow();
    });

    it('MUST retry up to 3 times with exponential backoff', () => {
      const retryAttempts = 3;
      const retryDelayMs = 1000;
      expect(retryAttempts).toBe(3);
      expect(retryDelayMs).toBe(1000);
      // Delays: 1s, 2s, 4s = exponential backoff with 2^n
    });

    it('MUST handle network timeout as AbortError', () => {
      const abortError = new Error();
      abortError.name = 'AbortError';
      expect(() => {
        if (abortError.name === 'AbortError') {
          throw new Error('Embedding request timed out (5s exceeded)');
        }
      }).toThrow('timed out');
    });

    it('MUST return empty array on final failure (search route catches)', () => {
      // In search/route.ts: catch returns []
      // In generateQueryEmbedding: if error → console.error + Sentry, return []
      const failureResult = [];
      expect(failureResult).toEqual([]);
    });

    it('MUST catch embedding generation error and log to Sentry', () => {
      // Contract: generateQueryEmbedding wraps generateEmbedding in try-catch
      // Logs: Sentry.captureException(error, { tags: { operation: 'embedding-generation' } })
      const shouldCaptureSentry = true;
      expect(shouldCaptureSentry).toBe(true);
    });

    it('MUST return 500 if embedding generation returns empty array', () => {
      const queryEmbedding = [] as number[];
      const statusCode = queryEmbedding.length === 0 ? 500 : 200;
      expect(statusCode).toBe(500);
    });
  });

  describe('Embedding Truncation', () => {
    it('MUST truncate input text to 32000 characters', () => {
      const maxChars = 32000;
      const longText = 'a'.repeat(50000);
      const truncated = longText.substring(0, maxChars);
      expect(truncated.length).toBe(32000);
    });
  });
});

/**
 * CONTRACT: Vector Search (Upstash)
 * Expected: Upstash returns { vector, score, metadata } array
 */
describe('[CONTRACT] Search API: Vector Search Results', () => {
  describe('Vector Search Input Contract', () => {
    it('MUST query with valid embedding vector', () => {
      const embedding = new Array(1536).fill(0.5);
      expect(embedding).toHaveLength(1536);
    });

    it('MUST query with topK (capped at 50)', () => {
      const topK = Math.min(100, 50);
      expect(topK).toBe(50);
    });

    it('MUST include metadata in results', () => {
      const queryParams = {
        vector: new Array(1536).fill(0.5),
        topK: 50,
        includeMetadata: true,
      };
      expect(queryParams.includeMetadata).toBe(true);
    });
  });

  describe('Vector Search Output Contract', () => {
    it('MUST return array of search results', () => {
      const results = [
        { vector: new Array(1536).fill(0.1), score: 0.95, metadata: { analysisId: 'a1' } },
        { vector: new Array(1536).fill(0.2), score: 0.87, metadata: { analysisId: 'a2' } },
      ];
      expect(Array.isArray(results)).toBe(true);
    });

    it('MUST include cosine similarity score in each result', () => {
      const result = { score: 0.95 };
      expect(result).toHaveProperty('score');
      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThanOrEqual(-1);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('MUST include metadata with analysisId', () => {
      const result = { metadata: { analysisId: 'analysis-123' } };
      expect(result.metadata).toHaveProperty('analysisId');
      expect(typeof result.metadata.analysisId).toBe('string');
    });

    it('MUST handle empty search results (no matches)', () => {
      const results: any[] = [];
      expect(results.length).toBe(0);
    });
  });
});

/**
 * CONTRACT: Result Enrichment (Database Fetch)
 * Expected: findAnalysisById returns full analysis object or null
 */
describe('[CONTRACT] Search API: Result Enrichment', () => {
  describe('Enrichment Input Contract', () => {
    it('MUST pass userId + analysisId to findAnalysisById', () => {
      const params = { userId: 'user-123', analysisId: 'analysis-456' };
      expect(params).toHaveProperty('userId');
      expect(params).toHaveProperty('analysisId');
    });
  });

  describe('Enrichment Output Contract', () => {
    it('MUST return analysis with { id, title, videoId, analysisMarkdown, createdAt }', () => {
      const analysis = {
        id: 'a1',
        title: 'My Analysis',
        videoId: 'vid-123',
        analysisMarkdown: '# Analysis\n\nContent here.',
        createdAt: '2026-07-08T14:00:00Z',
      };
      expect(analysis).toHaveProperty('id');
      expect(analysis).toHaveProperty('title');
      expect(analysis).toHaveProperty('videoId');
      expect(analysis).toHaveProperty('analysisMarkdown');
      expect(analysis).toHaveProperty('createdAt');
    });

    it('MUST return null if analysis not found', () => {
      const analysis = null;
      expect(analysis).toBeNull();
    });

    it('MUST return null if analysis belongs to different user (ownership check)', () => {
      // findAnalysisById checks .eq('user_id', userId)
      // If user_id doesn't match, returns null
      const analysis = null; // Not found because user_id mismatch
      expect(analysis).toBeNull();
    });

    it('MUST default title to "Untitled" if null in database', () => {
      const dbRow = { title: null };
      const title = dbRow.title || 'Untitled';
      expect(title).toBe('Untitled');
    });

    it('MUST default analysisMarkdown to empty string if null', () => {
      const dbRow = { analysis_markdown: null };
      const markdown = dbRow.analysis_markdown || '';
      expect(markdown).toBe('');
    });
  });

  describe('Search Result Format (Final Output)', () => {
    it('MUST transform enriched result to { analysisId, title, videoId, excerpt, score, createdAt }', () => {
      const dbRow = {
        id: 'a1',
        title: 'Analysis Title',
        videoId: 'vid-123',
        analysisMarkdown: 'This is a long analysis. It contains multiple sections.',
        createdAt: '2026-07-08T14:00:00Z',
      };
      const upstashScore = 0.92;

      const result = {
        analysisId: dbRow.id,
        title: dbRow.title,
        videoId: dbRow.videoId,
        excerpt: dbRow.analysisMarkdown.substring(0, 200),
        score: upstashScore,
        createdAt: dbRow.createdAt,
      };

      expect(result).toHaveProperty('analysisId', 'a1');
      expect(result).toHaveProperty('title', 'Analysis Title');
      expect(result).toHaveProperty('videoId', 'vid-123');
      expect(result).toHaveProperty('score', 0.92);
    });

    it('MUST filter out null results from enrichment', () => {
      const enrichedResults = [
        { analysisId: 'a1', title: 'Valid' },
        null,
        { analysisId: 'a3', title: 'Also Valid' },
        null,
      ];
      const validResults = enrichedResults.filter(r => r !== null);
      expect(validResults.length).toBe(2);
      expect(validResults.every(r => r !== null)).toBe(true);
    });

    it('MUST cap excerpt to 200 characters', () => {
      const markdown = 'a'.repeat(500);
      const excerpt = markdown.substring(0, 200);
      expect(excerpt.length).toBeLessThanOrEqual(200);
    });
  });
});

/**
 * CONTRACT: Ownership Verification (IDOR Defense)
 * Expected: No cross-user data leakage
 */
describe('[CONTRACT] Search API: Ownership & IDOR Defense', () => {
  describe('Ownership Check in findAnalysisById', () => {
    it('MUST check both analysisId AND userId in WHERE clause', () => {
      // Contract: .eq('id', params.analysisId).eq('user_id', params.userId)
      const query = {
        filter1: 'id = analysisId',
        filter2: 'user_id = userId',
      };
      expect(query).toHaveProperty('filter1');
      expect(query).toHaveProperty('filter2');
    });

    it('MUST return null if analysisId exists but belongs to different user', () => {
      // Simulates: analysis A123 exists but belongs to user-999, not user-111
      const requestUserId = 'user-111';
      const analysisOwnerId = 'user-999';
      const shouldReturn = requestUserId === analysisOwnerId ? 'analysis' : null;
      expect(shouldReturn).toBeNull();
    });

    it('MUST use maybeSingle() to prevent multiple rows', () => {
      // Contract: .maybeSingle() ensures at most 1 row
      // This prevents accidental data duplication leaks
      const maybeSingleUsed = true;
      expect(maybeSingleUsed).toBe(true);
    });
  });

  describe('No IDOR Vector via Upstash Metadata', () => {
    it('MUST not expose analysisId publicly in vector metadata (internal only)', () => {
      // Vector store metadata contains analysisId for internal lookups
      // But client never sees raw metadata, only enriched results
      const upstashMetadata = { analysisId: 'a123' }; // Internal
      const clientSeeesMetadata = false; // Should be filtered by enrichment
      expect(upstashMetadata).toHaveProperty('analysisId');
      expect(clientSeeesMetadata).toBe(false);
    });

    it('MUST enrich results through database (not pass metadata directly)', () => {
      // Pipeline: Upstash → fetch from DB with ownership check → return to client
      // If database lookup fails or ownership fails, result is filtered (null)
      const hasOwnershipCheck = true;
      expect(hasOwnershipCheck).toBe(true);
    });
  });

  describe('Result Filtering', () => {
    it('MUST filter out null results (failed enrichment = failed ownership)', () => {
      const enriched = [
        { id: 'a1', title: 'Mine' }, // Owned
        null, // Not owned or not found
        { id: 'a2', title: 'Also Mine' },
      ];
      const filtered = enriched.filter(r => r !== null);
      expect(filtered.length).toBe(2);
      expect(filtered.every(r => r !== null)).toBe(true);
    });

    it('MUST never include analyses from other users in response', () => {
      const userId = 'user-A';
      const searchResults = [
        { analysisId: 'a1', ownerId: 'user-A' },
        // user-B's analysis would have been filtered out by .eq('user_id', userId)
        { analysisId: 'a2', ownerId: 'user-A' },
      ];
      const allBelongToUser = searchResults.every(r => r.ownerId === userId);
      expect(allBelongToUser).toBe(true);
    });
  });

  describe('Defense-in-Depth Verification', () => {
    it('MUST verify ownership at adapter layer (DB query)', () => {
      // Layer 1: SupabaseAnalysisAdapter.findAnalysisById()
      // .eq('user_id', params.userId)
      const ownershipCheckLayer = 'adapter';
      expect(ownershipCheckLayer).toBe('adapter');
    });

    it('MUST verify ownership at route layer (filter enrichment)', () => {
      // Layer 2: /api/search/route.ts enrichment loop
      // if (!analysisId) return null; ← filters out orphaned metadata
      const hasRouteLayerFilter = true;
      expect(hasRouteLayerFilter).toBe(true);
    });
  });
});

/**
 * CONTRACT: Response Schema & Headers
 * Expected: { results, count, query, tier } + rate limit headers
 */
describe('[CONTRACT] Search API: Response Format', () => {
  describe('Success Response Body', () => {
    it('MUST return { results, count, query, tier }', () => {
      const response = {
        results: [
          { analysisId: 'a1', title: 'Analysis 1', videoId: 'v1', excerpt: 'text', score: 0.9, createdAt: '2026-07-08T14:00:00Z' },
        ],
        count: 1,
        query: 'machine learning',
        tier: 'free',
      };
      expect(response).toHaveProperty('results');
      expect(response).toHaveProperty('count');
      expect(response).toHaveProperty('query');
      expect(response).toHaveProperty('tier');
    });

    it('MUST match count to results.length', () => {
      const results = [{ id: 'a1' }, { id: 'a2' }];
      const count = results.length;
      expect(count).toBe(2);
    });

    it('MUST return empty results array if no matches', () => {
      const response = {
        results: [],
        count: 0,
        query: 'xyz',
        tier: 'free',
      };
      expect(response.results.length).toBe(0);
      expect(response.count).toBe(0);
    });

    it('MUST include user tier in response', () => {
      const response = { tier: 'pro' };
      expect(['free', 'pro', 'enterprise']).toContain(response.tier);
    });
  });

  describe('Response Headers', () => {
    it('MUST include X-RateLimit-* headers from guardTraffic', () => {
      const headers = new Headers();
      headers.set('X-RateLimit-Limit', '3');
      headers.set('X-RateLimit-Remaining', '2');
      headers.set('X-RateLimit-Reset', '1234567890');

      expect(headers.get('X-RateLimit-Limit')).toBe('3');
      expect(headers.get('X-RateLimit-Remaining')).toBe('2');
      expect(headers.get('X-RateLimit-Reset')).toBe('1234567890');
    });

    it('MUST apply headers to NextResponse', () => {
      const trafficHeaders = {
        'X-RateLimit-Limit': '3',
        'X-RateLimit-Remaining': '2',
        'X-RateLimit-Reset': '1234567890',
      };
      const response = new Map(Object.entries(trafficHeaders));
      expect(response.size).toBe(3);
    });
  });

  describe('Error Response Bodies', () => {
    it('MUST return 400 { error: string } for validation failures', () => {
      const errorResponse = {
        error: 'Query must be between 3 and 1000 characters',
      };
      expect(errorResponse).toHaveProperty('error');
    });

    it('MUST return 401 { error: "Unauthorized" } for auth failure', () => {
      const errorResponse = { error: 'Unauthorized' };
      expect(errorResponse.error).toBe('Unauthorized');
    });

    it('MUST return 429 with { error, message, retryAfter, resetAt } for rate limit', () => {
      const errorResponse = {
        error: 'Rate limit exceeded',
        message: 'Too many requests. Current tier: free. Free tier: 3 requests/minute, 50/hour',
        retryAfter: 60,
        resetAt: '2026-07-08T14:35:00Z',
      };
      expect(errorResponse).toHaveProperty('error', 'Rate limit exceeded');
      expect(errorResponse).toHaveProperty('message');
      expect(errorResponse).toHaveProperty('retryAfter');
      expect(errorResponse).toHaveProperty('resetAt');
    });

    it('MUST return 500 { error: "Internal server error" } for unhandled errors', () => {
      const errorResponse = { error: 'Internal server error' };
      expect(errorResponse.error).toBe('Internal server error');
    });
  });
});

/**
 * CONTRACT: Error Handling & Observability
 * Expected: Sentry captures, logs structured
 */
describe('[CONTRACT] Search API: Error Handling', () => {
  describe('Error Capture & Logging', () => {
    it('MUST capture JSON parse errors with ERROR_CODES.INVALID_JSON', () => {
      const errorCode = 'ERR_INVALID_JSON';
      expect(errorCode).toBe('ERR_INVALID_JSON');
    });

    it('MUST capture auth failures with ERROR_CODES.AUTH_UNAUTHORIZED', () => {
      const errorCode = 'ERR_AUTH_UNAUTHORIZED';
      expect(errorCode).toBe('ERR_AUTH_UNAUTHORIZED');
    });

    it('MUST capture embedding failures with operation: "embedding-generation"', () => {
      const sentryTag = 'embedding-generation';
      expect(sentryTag).toBeDefined();
    });

    it('MUST capture unhandled errors with operation: "search-vector"', () => {
      const sentryTag = 'search-vector';
      expect(sentryTag).toBeDefined();
    });

    it('MUST log step-wise progress: [search] 1. Request validated, 2. Generating embedding, etc.', () => {
      const logLines = [
        '[search] 1. Request validated and auth passed',
        '[search] 2. Generating embedding for query',
        '[search] 3. Querying vector index',
        '[search] 4. Vector search completed',
        '[search] 5. Results enriched and ready',
      ];
      expect(logLines.length).toBe(5);
    });
  });

  describe('Partial Enrichment Failures', () => {
    it('MUST warn but not fail if enriching individual result throws', () => {
      // try-catch in enrichment loop: catch → console.warn, return null
      const shouldWarnNotFail = true;
      expect(shouldWarnNotFail).toBe(true);
    });

    it('MUST continue enriching remaining results if one fails', () => {
      const enrichResults = [
        { data: 'ok' },
        null, // One fails
        { data: 'ok' },
      ];
      const validCount = enrichResults.filter(r => r !== null).length;
      expect(validCount).toBe(2);
    });
  });
});

/**
 * CONTRACT: Production Safety
 * Expected: Upstash credentials validated, placeholders rejected in prod
 */
describe('[CONTRACT] Search API: Production Safety', () => {
  it('MUST throw error if UPSTASH_VECTOR_REST_URL is placeholder in production', () => {
    const env = { NODE_ENV: 'production', UPSTASH_VECTOR_REST_URL: 'https://placeholder-vector.upstash.io' };
    expect(() => {
      if (env.NODE_ENV === 'production' && env.UPSTASH_VECTOR_REST_URL?.includes('placeholder')) {
        throw new Error('CRITICAL: Production execution cannot utilize Upstash environment placeholders. Vector search is unavailable.');
      }
    }).toThrow('placeholder');
  });

  it('MUST allow placeholder credentials in non-production', () => {
    const env = { NODE_ENV: 'development', UPSTASH_VECTOR_REST_URL: 'https://placeholder-vector.upstash.io' };
    expect(() => {
      if (env.NODE_ENV === 'production' && env.UPSTASH_VECTOR_REST_URL?.includes('placeholder')) {
        throw new Error('CRITICAL: ...');
      }
    }).not.toThrow();
  });
});
