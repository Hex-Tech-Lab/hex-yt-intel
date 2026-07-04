/**
 * Contract tests for the server-to-server content signature (web/lib/stream-token.ts).
 *
 * This is the trust boundary between the Cloudflare Worker (signer) and the Vercel
 * persist routes (verifier). The message layout must stay byte-identical to the
 * worker's signBoundContent (worker/src/crypto.ts), so these tests pin:
 *   - the canonical message format,
 *   - that a bound signature is rejected when expired, cross-purpose, cross-id, or
 *     when the content is tampered,
 *   - and that the legacy content-only path still round-trips (rollout compat).
 *
 * Signatures are minted with Node's HMAC, which is byte-identical to the Web
 * Crypto HMAC-SHA256 both runtimes use — so a green test also proves cross-runtime
 * parity of the primitive.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';

const SECRET = 'test-stream-hmac-secret';

// Set before importing the module under test — env.streamHmacSecret reads process.env lazily.
beforeAll(() => {
  process.env.STREAM_HMAC_SECRET = SECRET;
});

const sign = (message: string) => createHmac('sha256', SECRET).update(message).digest('hex');

describe('boundContentMessage', () => {
  it('produces the exact cross-runtime wire format', async () => {
    const { boundContentMessage } = await import('../stream-token');
    expect(boundContentMessage('persist', 'analysis-1', 123, 'CONTENT')).toBe('persist:analysis-1:123:CONTENT');
    expect(boundContentMessage('chat-persist', 'conv-9', 456, 'REPLY')).toBe('chat-persist:conv-9:456:REPLY');
  });
});

describe('verifyContentSig — bound signatures', () => {
  const content = 'the assistant reply text';
  const future = () => Date.now() + 60_000;

  it('accepts a valid, unexpired, correctly-bound signature', async () => {
    const { verifyContentSig, boundContentMessage } = await import('../stream-token');
    const exp = future();
    const sig = sign(boundContentMessage('persist', 'a1', exp, content));
    await expect(verifyContentSig(content, sig, { purpose: 'persist', id: 'a1', exp })).resolves.toBe(true);
  });

  it('rejects an expired signature', async () => {
    const { verifyContentSig, boundContentMessage } = await import('../stream-token');
    const exp = Date.now() - 1; // already expired
    const sig = sign(boundContentMessage('persist', 'a1', exp, content));
    await expect(verifyContentSig(content, sig, { purpose: 'persist', id: 'a1', exp })).resolves.toBe(false);
  });

  it('rejects a cross-purpose replay (chat signature reused as persist)', async () => {
    const { verifyContentSig, boundContentMessage } = await import('../stream-token');
    const exp = future();
    const chatSig = sign(boundContentMessage('chat-persist', 'a1', exp, content));
    await expect(verifyContentSig(content, chatSig, { purpose: 'persist', id: 'a1', exp })).resolves.toBe(false);
  });

  it('rejects a signature bound to a different resource id', async () => {
    const { verifyContentSig, boundContentMessage } = await import('../stream-token');
    const exp = future();
    const sig = sign(boundContentMessage('persist', 'a1', exp, content));
    await expect(verifyContentSig(content, sig, { purpose: 'persist', id: 'a2', exp })).resolves.toBe(false);
  });

  it('rejects tampered content', async () => {
    const { verifyContentSig, boundContentMessage } = await import('../stream-token');
    const exp = future();
    const sig = sign(boundContentMessage('persist', 'a1', exp, content));
    await expect(verifyContentSig('different content', sig, { purpose: 'persist', id: 'a1', exp })).resolves.toBe(false);
  });
});

describe('verifyContentSig — legacy content-only (rollout compat)', () => {
  const content = 'legacy body';

  it('accepts a content-only signature when no binding is supplied', async () => {
    const { verifyContentSig } = await import('../stream-token');
    const sig = sign(content);
    await expect(verifyContentSig(content, sig)).resolves.toBe(true);
  });

  it('does not accept a legacy signature when a binding is required', async () => {
    const { verifyContentSig } = await import('../stream-token');
    const exp = Date.now() + 60_000;
    const legacySig = sign(content);
    await expect(verifyContentSig(content, legacySig, { purpose: 'persist', id: 'a1', exp })).resolves.toBe(false);
  });
});
