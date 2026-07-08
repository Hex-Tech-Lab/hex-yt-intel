import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

/**
 * Tests for the question capture endpoint
 * POST /api/chat/capture-question
 */

// Mock dependencies
vi.mock('@/lib/adapters', () => ({
  SupabaseAuthAdapter: vi.fn().mockImplementation(() => ({
    authenticate: vi.fn(),
  })),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: vi.fn(),
}));

vi.mock('sentry/nextjs', () => ({
  captureException: vi.fn(),
  flush: vi.fn(),
}));

describe('POST /api/chat/capture-question', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should capture a question successfully', async () => {
    // Setup
    const { SupabaseAuthAdapter } = await import('@/lib/adapters');
    const authInstance = new SupabaseAuthAdapter();
    vi.spyOn(authInstance, 'authenticate').mockResolvedValueOnce({
      userId: 'user-123',
      tier: 'pro',
    } as any);

    const mockRequest = new NextRequest('http://localhost:3000/api/chat/capture-question', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conv-123',
        userId: 'user-123',
        question: 'What is the main topic of this video?',
        analysisId: 'analysis-123',
      }),
    });

    // Execute
    const response = await POST(mockRequest);
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.questionId).toBeDefined();
    expect(data.stored_at).toBeDefined();
  });

  it('should return 401 when user is not authenticated', async () => {
    // Setup
    const { SupabaseAuthAdapter } = await import('@/lib/adapters');
    const authInstance = new SupabaseAuthAdapter();
    vi.spyOn(authInstance, 'authenticate').mockResolvedValueOnce(null);

    const mockRequest = new NextRequest('http://localhost:3000/api/chat/capture-question', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conv-123',
        userId: 'user-123',
        question: 'Test',
      }),
    });

    // Execute
    const response = await POST(mockRequest);

    // Assert
    expect(response.status).toBe(401);
  });

  it('should return 403 when user_id does not match authenticated user', async () => {
    // Setup
    const { SupabaseAuthAdapter } = await import('@/lib/adapters');
    const authInstance = new SupabaseAuthAdapter();
    vi.spyOn(authInstance, 'authenticate').mockResolvedValueOnce({
      userId: 'user-123',
      tier: 'pro',
    } as any);

    const mockRequest = new NextRequest('http://localhost:3000/api/chat/capture-question', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conv-123',
        userId: 'user-456', // Different user
        question: 'Test',
      }),
    });

    // Execute
    const response = await POST(mockRequest);

    // Assert
    expect(response.status).toBe(403);
  });

  it('should return 400 with invalid payload (missing required fields)', async () => {
    // Setup
    const { SupabaseAuthAdapter } = await import('@/lib/adapters');
    const authInstance = new SupabaseAuthAdapter();
    vi.spyOn(authInstance, 'authenticate').mockResolvedValueOnce({
      userId: 'user-123',
      tier: 'pro',
    } as any);

    const mockRequest = new NextRequest('http://localhost:3000/api/chat/capture-question', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conv-123',
        // Missing userId and question
      }),
    });

    // Execute
    const response = await POST(mockRequest);

    // Assert
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Invalid payload');
  });

  it('should return 400 when question exceeds max length', async () => {
    // Setup
    const { SupabaseAuthAdapter } = await import('@/lib/adapters');
    const authInstance = new SupabaseAuthAdapter();
    vi.spyOn(authInstance, 'authenticate').mockResolvedValueOnce({
      userId: 'user-123',
      tier: 'pro',
    } as any);

    const tooLongQuestion = 'a'.repeat(5001);
    const mockRequest = new NextRequest('http://localhost:3000/api/chat/capture-question', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conv-123',
        userId: 'user-123',
        question: tooLongQuestion,
      }),
    });

    // Execute
    const response = await POST(mockRequest);

    // Assert
    expect(response.status).toBe(400);
  });

  it('should handle idempotent captures (same timestamp + questionId)', async () => {
    // Setup
    const { SupabaseAuthAdapter } = await import('@/lib/adapters');
    const authInstance = new SupabaseAuthAdapter();
    vi.spyOn(authInstance, 'authenticate').mockResolvedValueOnce({
      userId: 'user-123',
      tier: 'pro',
    } as any);

    const timestamp = new Date().toISOString();
    const mockRequest = new NextRequest('http://localhost:3000/api/chat/capture-question', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conv-123',
        userId: 'user-123',
        question: 'Same question',
        timestamp,
      }),
    });

    // Execute first
    const response1 = await POST(mockRequest);
    const data1 = await response1.json();

    // Execute second with same timestamp (idempotency)
    const mockRequest2 = new NextRequest('http://localhost:3000/api/chat/capture-question', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conv-123',
        userId: 'user-123',
        question: 'Same question',
        timestamp,
      }),
    });
    const response2 = await POST(mockRequest2);
    const data2 = await response2.json();

    // Assert
    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    // Both should succeed but have different questionIds (UUID-based)
    expect(data1.questionId).toBeDefined();
    expect(data2.questionId).toBeDefined();
  });

  it('should accept optional analysisId', async () => {
    // Setup
    const { SupabaseAuthAdapter } = await import('@/lib/adapters');
    const authInstance = new SupabaseAuthAdapter();
    vi.spyOn(authInstance, 'authenticate').mockResolvedValueOnce({
      userId: 'user-123',
      tier: 'pro',
    } as any);

    const mockRequest = new NextRequest('http://localhost:3000/api/chat/capture-question', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conv-123',
        userId: 'user-123',
        question: 'Test question',
        analysisId: 'analysis-456',
      }),
    });

    // Execute
    const response = await POST(mockRequest);
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('should gracefully handle storage failures (fire-and-forget)', async () => {
    // Setup
    const { SupabaseAuthAdapter } = await import('@/lib/adapters');
    const authInstance = new SupabaseAuthAdapter();
    vi.spyOn(authInstance, 'authenticate').mockResolvedValueOnce({
      userId: 'user-123',
      tier: 'pro',
    } as any);

    // Mock storage to fail
    const { getSupabaseServiceClient } = await import('@/lib/supabase');
    vi.mocked(getSupabaseServiceClient).mockReturnValueOnce({
      storage: {
        from: () => ({
          upload: vi.fn().mockResolvedValueOnce({ error: new Error('Storage error') }),
          list: vi.fn().mockResolvedValueOnce({ data: null, error: null }),
        }),
      },
    } as any);

    const mockRequest = new NextRequest('http://localhost:3000/api/chat/capture-question', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conv-123',
        userId: 'user-123',
        question: 'Test question',
      }),
    });

    // Execute
    const response = await POST(mockRequest);
    const data = await response.json();

    // Assert: response should still succeed (fire-and-forget pattern)
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
