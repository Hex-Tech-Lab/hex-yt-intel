/**
 * chat-stream.ts — requestId propagation test matrix (4 scenarios)
 *
 * Verifies every SSE emission path carries the correct requestId:
 * 1. Success + persist ok
 * 2. Success + persist fail
 * 3. Empty + persist ok
 * 4. Error + persist fail
 *
 * Also verifies event ordering and fallback branch tagging.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from 'hono';

type EmittedEvent =
  | { type: 'delta'; content: string; requestId?: string }
  | { type: 'persist'; status: 'saving' | 'saved' | 'failed'; requestId?: string }
  | { type: 'done'; requestId?: string };

type TestMode = 'success' | 'empty' | 'error';
type PersistMode = 'ok' | 'fail';

interface TestCase {
  name: string;
  mode: TestMode;
  persistMode: PersistMode;
  expectedOrder: string[];
  expectedDeltaContent: string;
}

describe('Edge Transport Engine: Request Tracking Assertions', () => {
  const TARGET_REQUEST_ID = 'req-core-2026-x9';
  let trackingSink: EmittedEvent[];
  let streamChatCascadeSpy: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    trackingSink = [];
    vi.restoreAllMocks();
  });

  function buildMockContext(): Context<{ Bindings: any }> {
    const targetUrl = new URL('https://gateway.hex-tech.internal/api/chat-stream');
    targetUrl.searchParams.set('requestId', TARGET_REQUEST_ID);

    const payload = {
      sig: '0x9923a1fbc7',
      exp: Date.now() + 30000,
      appUrl: 'https://app.runti.me',
      requestId: TARGET_REQUEST_ID,
      conversationId: 'conv-test',
      userId: 'user-test',
      models: ['liquid-nn-ultra-v5'],
      grounding: '',
      history: [],
    };

    const request = new Request(targetUrl.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const sendFn = vi.fn((event: unknown) => {
      trackingSink.push(event as EmittedEvent);
    });

    return {
      req: {
        json: async () => payload,
        raw: request,
        header: (name: string) => request.headers.get(name),
      },
      env: {
        APP_URL: 'https://app.runti.me',
        OPENROUTER_API_KEY: 'sk-or-live-01aa823',
        STREAM_HMAC_SECRET: 'test-secret',
        NODE_ENV: 'development',
        DEV_HMAC_SECRET: 'test-secret',
      },
      send: sendFn,
      waitUntil: vi.fn(),
      header: vi.fn(),
      status: vi.fn(),
      executionCtx: { waitUntil: vi.fn() },
    } as unknown as Context<{ Bindings: any }>;
  }

  const executionMatrix: TestCase[] = [
    {
      name: 'Standard Engine Path with Storage Confirmation',
      mode: 'success',
      persistMode: 'ok',
      expectedOrder: ['delta', 'persist:saving', 'persist:saved', 'done'],
      expectedDeltaContent: 'Transmitted operational payload tokens.',
    },
    {
      name: 'Standard Engine Path with Storage Interruption',
      mode: 'success',
      persistMode: 'fail',
      expectedOrder: ['delta', 'persist:saving', 'persist:failed', 'done'],
      expectedDeltaContent: 'Transmitted operational payload tokens.',
    },
    {
      name: 'Void Cascade Interpolation with Storage Confirmation',
      mode: 'empty',
      persistMode: 'ok',
      expectedOrder: ['delta', 'persist:saving', 'persist:saved', 'done'],
      expectedDeltaContent: 'No response generated.',
    },
    {
      name: 'Systemic Engine Crash with Storage Interruption Failure',
      mode: 'error',
      persistMode: 'fail',
      expectedOrder: ['delta', 'persist:saving', 'persist:failed', 'done'],
      expectedDeltaContent: 'The model request failed. Your message is saved — please try again.',
    },
  ];

  it.each(executionMatrix)('$name', async ({ mode, persistMode, expectedOrder, expectedDeltaContent }) => {
    const executionContext = buildMockContext();

    const chatStreamModule = await import('../../worker/src/chat-stream');

    streamChatCascadeSpy = vi.spyOn(chatStreamModule as any, 'streamChatCascade').mockImplementation(
      async (_key: string, _ground: boolean, _hist: unknown[], onChunk: (c: string) => void) => {
        if (mode === 'success') {
          onChunk('Transmitted operational payload tokens.');
          return 'Transmitted operational payload tokens.';
        }
        if (mode === 'empty') return '';
        throw new Error('Structural pipeline interruption executed.');
      }
    );

    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (targetInput: RequestInfo | URL) => {
      if (String(targetInput).includes('/api/chat/persist')) {
        return new Response(null, { status: persistMode === 'ok' ? 200 : 500 });
      }
      return new Response(null, { status: 200 });
    });

    await chatStreamModule.handleChatStream(executionContext as any);

    // Assert tracking density
    expect(trackingSink.length).toBeGreaterThan(0);

    // Validate strict Request ID tagging on every event frame
    for (const frame of trackingSink) {
      expect(frame.requestId).toBe(TARGET_REQUEST_ID);
    }

    // Validate absolute event sequence tracking
    const runtimeOrder = trackingSink.map((frame) => {
      if (frame.type === 'delta') return 'delta';
      if (frame.type === 'done') return 'done';
      return `persist:${frame.status}`;
    });
    expect(runtimeOrder).toEqual(expectedOrder);

    // Verify content delivery integrity
    const deltaEvents = trackingSink.filter(
      (f): f is Extract<EmittedEvent, { type: 'delta' }> => f.type === 'delta'
    );
    expect(deltaEvents.at(-1)?.content).toBe(expectedDeltaContent);

    expect(fetchSpy).toHaveBeenCalled();
  });
});
