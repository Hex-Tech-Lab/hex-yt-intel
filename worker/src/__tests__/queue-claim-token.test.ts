/**
 * T12c wiring: the Queues consumer entrypoint must pass message.id to the
 * handler as the claim token, and retry (not ack) when the handler throws.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handle = vi.hoisted(() => vi.fn());
vi.mock('@sentry/cloudflare', () => ({ init: vi.fn(), captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@sentry/hono/cloudflare', () => ({ sentry: vi.fn(() => (_c: unknown, next: () => unknown) => next()) }));
vi.mock('../queue-consumers/comments-tier3', () => ({ handleCommentsTier3Message: handle }));

import worker from '../worker';

const msg = (id: string) => ({ id, body: { sampleRunId: 'r' }, ack: vi.fn(), retry: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('queue consumer claim token', () => {
  it('passes message.id as the 3rd argument and acks on success', async () => {
    handle.mockResolvedValue(undefined);
    const m = msg('msg-1');
    await worker.queue({ messages: [m] } as never, {} as never);
    expect(handle).toHaveBeenCalledWith(m.body, {}, 'msg-1');
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
  });

  it('negative control: handler throws -> retry, never ack', async () => {
    handle.mockRejectedValue(new Error('claim not recorded'));
    const m = msg('msg-2');
    await worker.queue({ messages: [m] } as never, {} as never);
    expect(m.retry).toHaveBeenCalledTimes(1);
    expect(m.ack).not.toHaveBeenCalled();
  });
});
