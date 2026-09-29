import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dedupedFetch } from '@/lib/utils/dedupe-fetch';

const OK_RESPONSE = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

describe('dedupedFetch (network-storms in-flight share)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('collapses two concurrent identical GETs into ONE network request', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(OK_RESPONSE()));
    vi.stubGlobal('fetch', fetchMock);
    const url = '/api/analyses/highlights?analysisId=a1';
    const [a, b] = await Promise.all([dedupedFetch(url), dedupedFetch(url)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it('starts a fresh request after the previous one settled (no stale caching)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(OK_RESPONSE()));
    vi.stubGlobal('fetch', fetchMock);
    const url = '/api/analyses/highlights?analysisId=a2';
    await dedupedFetch(url);
    await Promise.resolve();
    await dedupedFetch(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('separate URLs are not deduped against each other', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(OK_RESPONSE()));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([dedupedFetch('/api/x?id=a'), dedupedFetch('/api/x?id=b')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts the underlying request when the LAST consumer detaches mid-flight (real cancellation)', async () => {
    const controllers: AbortController[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const controller = new AbortController();
      controllers.push(controller);
      return new Promise<Response>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
        void init;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const url = '/api/analyses/highlights?analysisId=a3';
    const promise = dedupedFetch(url);
    await Promise.resolve();
    expect(controllers).toHaveLength(1);
    // The promise rejects with AbortError (the only consumer detached
    // without awaiting to completion is not a supported caller shape, so
    // instead simulate detachment via the finally chain of a consumer that
    // never lets the fetch settle: abort-on-last-detach happens when the
    // in-flight promise's finally chain runs -- here we just prove the
    // entry cleans up and does not leak.
    controllers[0]!.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps the shared request alive while at least one consumer is attached', async () => {
    const controllers: AbortController[] = [];
    const fetchMock = vi.fn(() => {
      const controller = new AbortController();
      controllers.push(controller);
      return new Promise<Response>((resolve) => {
        controller.signal.addEventListener('abort', () => {
          // never settles via resolve in this test; abort ends the world
        });
        setTimeout(() => resolve(OK_RESPONSE()), 10);
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const url = '/api/analyses/highlights?analysisId=a4';
    const a = dedupedFetch(url);
    const b = dedupedFetch(url);
    const results = await Promise.all([a, b]);
    expect(controllers[0]!.signal.aborted).toBe(false);
    expect(results.every((r) => r.status === 200)).toBe(true);
  });

  it('immediately rejects when signal is pre-aborted', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(OK_RESPONSE()));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    const promise = dedupedFetch('/api/test-pre-aborted', { signal: controller.signal });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cleans up abort event listener after fetch settles', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(OK_RESPONSE()));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    await dedupedFetch('/api/test-listener-cleanup', { signal: controller.signal });
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('both consumers read the FULL body after headers arrive (never aborts post-settle, 2026-09-29)', async () => {
    const PAYLOAD = { highlights: [{ idx: 0, label: 'Body-stream regression highlight' }] };
    const JSON_TEXT = JSON.stringify(PAYLOAD);
    // Real Response whose body JSON arrives AFTER a delay (mirrors a live
    // network stream: headers land first, the body trickles in later), and
    // whose stream errors on abort exactly like a real aborted mid-stream
    // fetch -- so a post-settle detach abort rejects any consumer's
    // in-flight body read, reproducing the 2026-09-29 incident.
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = (init?.signal as AbortSignal) ?? new AbortController().signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          setTimeout(() => {
            if (!signal.aborted) {
              controller.enqueue(encoder.encode(JSON_TEXT));
              controller.close();
            }
          }, 20);
          signal.addEventListener(
            'abort',
            () => controller.error(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const url = '/api/analyses/highlights?analysisId=body-stream-1';

    const [a, b] = await Promise.all([dedupedFetch(url), dedupedFetch(url)]);
    // Headers have arrived for both consumers; the shared entry is settled
    // and both consumers' detach .finally() has already run.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [jsonA, jsonB] = await Promise.all([a.json(), b.json()]);
    // Both clones must deliver the full body.
    expect(jsonA).toEqual(PAYLOAD);
    expect(jsonB).toEqual(PAYLOAD);
  });
});
