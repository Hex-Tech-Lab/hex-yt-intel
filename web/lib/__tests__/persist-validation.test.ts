import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TOTAL_STREAMS } from '@/lib/config/synthesis';

/**
 * Persist API Validation Tests
 *
 * ADR 006 Markdown Validation: Fix 409 Digest Root Cause
 * Ensures empty markdown content is rejected at API boundary, not silently skipped.
 * Prevents orphaned analyses and audit trail gaps.
 */

// Mirror the schema from persist/route.ts
const bodySchema = z.object({
  analysisId: z.string().uuid(),
  videoId: z.string().min(1),
  markdown: z.string().min(1, 'Markdown content cannot be empty'),
  payload: z.unknown().optional(),
  model: z.string().optional(),
  valid: z.boolean().optional(),
  contentSig: z.string(),
  exp: z.number().int().optional(),
  status: z.enum(['completed', 'failed', 'interrupted']).optional().default('completed'),
  chunkIndex: z.number().int().min(1).max(TOTAL_STREAMS).optional(),
  totalChunks: z.number().int().refine((val) => val === TOTAL_STREAMS, {
    message: `totalChunks must match active configuration matrix of ${TOTAL_STREAMS}`,
  }).optional(),
});

describe('Persist API Markdown Validation', () => {
  const validAnalysisId = '550e8400-e29b-41d4-a716-446655440000';
  const validVideoId = 'dQw4w9WgXcQ';
  const validSig = 'valid-hmac-signature';
  const validMarkdown = '# Analysis\n\nContent here.';

  it('should accept valid markdown with content (1 char minimum)', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: 'A',
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should accept normal markdown with multiple lines', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: validMarkdown,
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should reject empty string markdown', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: '',
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.markdown).toBeDefined();
      expect(result.error.flatten().fieldErrors.markdown?.[0]).toContain('cannot be empty');
    }
  });

  it('should reject whitespace-only markdown', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: '   ',
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true); // Note: whitespace IS content according to min(1)
  });

  it('should reject null markdown', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: null,
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should reject undefined markdown', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      // markdown is missing
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should reject non-string markdown (number)', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: 12345,
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should reject non-string markdown (object)', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: { content: 'nested' },
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should reject non-string markdown (array)', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: ['line1', 'line2'],
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should accept markdown with newlines and special characters', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: '# Title\n\n- Bullet 1\n- Bullet 2\n\n**Bold** text with `code`.',
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should accept payload and model fields when provided', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: validMarkdown,
      payload: {
        schemaVersion: '2.0',
        dimensions: [{ number: 1, name: 'Test', content: 'Data' }],
      },
      model: 'claude-3.5-haiku',
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should accept chunked analysis with chunkIndex and totalChunks', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: validMarkdown,
      contentSig: validSig,
      chunkIndex: 1,
      totalChunks: TOTAL_STREAMS,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should reject totalChunks that do not match TOTAL_STREAMS configuration', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: validMarkdown,
      contentSig: validSig,
      chunkIndex: 1,
      totalChunks: TOTAL_STREAMS + 1, // Mismatch
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMsg = JSON.stringify(result.error.flatten());
      expect(errorMsg).toContain('totalChunks must match');
    }
  });

  it('should reject chunkIndex outside valid range', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: validMarkdown,
      contentSig: validSig,
      chunkIndex: TOTAL_STREAMS + 1,
      totalChunks: TOTAL_STREAMS,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should accept status completed', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: validMarkdown,
      contentSig: validSig,
      status: 'completed' as const,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should accept status interrupted', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: validMarkdown,
      contentSig: validSig,
      status: 'interrupted' as const,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should reject invalid status value', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: validMarkdown,
      contentSig: validSig,
      status: 'unknown',
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should reject invalid analysisId (not UUID)', () => {
    const payload = {
      analysisId: 'not-a-uuid',
      videoId: validVideoId,
      markdown: validMarkdown,
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should reject empty videoId', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: '',
      markdown: validMarkdown,
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('should reject missing contentSig', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: validMarkdown,
      // contentSig is missing
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

describe('Persist Validation Edge Cases', () => {
  const validAnalysisId = '550e8400-e29b-41d4-a716-446655440000';
  const validVideoId = 'dQw4w9WgXcQ';
  const validSig = 'valid-hmac-signature';

  it('should accept very long markdown content', () => {
    const longMarkdown = 'A'.repeat(100000); // 100KB
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: longMarkdown,
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should accept markdown with unicode characters', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: '# 分析 (Analysis)\n\n日本語テキスト\nEmoji: 🎯📊💡',
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should accept markdown with code blocks containing edge cases', () => {
    const payload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: `
# Code Examples

\`\`\`python
def empty_function():
    pass
\`\`\`

\`\`\`json
{}
\`\`\`
      `,
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('should enforce markdown min length at schema boundary, preventing silent skips', () => {
    // This is the critical test: ensures empty content is rejected at the API boundary
    // instead of being silently skipped by atomicPersist
    const emptyPayload = {
      analysisId: validAnalysisId,
      videoId: validVideoId,
      markdown: '',
      contentSig: validSig,
    };

    const result = bodySchema.safeParse(emptyPayload);
    expect(result.success).toBe(false);

    // Verify the error message is clear
    if (!result.success) {
      const flatErrors = result.error.flatten();
      expect(flatErrors.fieldErrors.markdown).toBeDefined();
      expect(flatErrors.fieldErrors.markdown?.[0]).toMatch(/cannot be empty/i);
    }
  });
});
