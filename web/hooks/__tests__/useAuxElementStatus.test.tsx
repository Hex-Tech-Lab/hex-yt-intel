/**
 * Regression tests for useAuxElementStatus's completion-time refetch
 * (RCA 2026-09-13, live video gKgWYFOhZx0).
 *
 * The LIVE streaming path seeds rawAnalysisPayload with a description-only
 * stub (useSSEStream deliberately excludes channelMeta/comments — they only
 * exist after the server-side stitch persists). The old
 * `if (payloadForThisAnalysis) return` guard then blocked the persisted-
 * payload fetch forever, so a live-watched analysis showed Channel Meta /
 * Comments chips gray for the whole session even though the persisted row
 * had both. The fix: a stub payload (no dimensions array — the UCIS schema
 * requires one in every stitched payload) triggers exactly one refetch at
 * completion; a restored payload (dimensions present) keeps skipping.
 */
// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAuxElementStatus } from '@/hooks/useAuxElementStatus';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';

const ANALYSIS_ID = '550e8400-e29b-41d4-a716-446655440000';

const FULL_PAYLOAD = {
  schemaVersion: '2.0',
  dimensions: [{ number: 2, name: 'Provenance', content: 'x' }],
  videoMetadata: { description: 'A description' },
  channelMeta: { subscriberCount: 25300 },
  comments: [{ author: '@a', text: 't', publishedAt: '2026-01-01T00:00:00Z', likeCount: 1 }],
  persona: { primary: { id: 'consultant', label: 'Consultant', weight: 1 } },
};

// The exact stub shape useSSEStream seeds at stream start.
const LIVE_STUB = { videoMetadata: { description: 'A description' } };

function mockFullPayloadFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes(`/api/analyses/${ANALYSIS_ID}`)) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: ANALYSIS_ID, analysis_payload: FULL_PAYLOAD, analysisStatus: 'complete' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  });
}

describe('useAuxElementStatus — completion-time refetch for the live description-only stub', () => {
  beforeEach(() => {
    useSynthesisNucleus.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useSynthesisNucleus.getState().reset();
  });

  it('refetches once at completion when the in-memory payload is the live stub, flipping Channel Meta/Comments green', async () => {
    // Simulate the live session: stub seeded during streaming, analysis now complete.
    useSynthesisNucleus.getState().setRawAnalysisPayload(LIVE_STUB as never, ANALYSIS_ID);
    const fetchMock = mockFullPayloadFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAuxElementStatus(ANALYSIS_ID, 'complete'));

    await waitFor(() => {
      expect(useSynthesisNucleus.getState().rawAnalysisPayload).toEqual(FULL_PAYLOAD);
    });
    expect(result.current).toEqual({ description: true, channelMeta: true, comments: true });

    // Exactly one fetch — the refetch must not loop on the now-full payload.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT refetch when the in-memory payload is a real stitched payload (dimensions present)', async () => {
    useSynthesisNucleus.getState().setRawAnalysisPayload(FULL_PAYLOAD as never, ANALYSIS_ID);
    const fetchMock = mockFullPayloadFetch();
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useAuxElementStatus(ANALYSIS_ID, 'complete'));

    await waitFor(() => {
      // Chips derive synchronously from the in-memory payload.
      expect(useSynthesisNucleus.getState().rawAnalysisPayloadId).toBe(ANALYSIS_ID);
    });
    // Give any (wrong) refetch a chance to fire.
    await new Promise((settleTimer) => setTimeout(settleTimer, 25));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches when no payload is in memory at all (restore path, unchanged behavior)', async () => {
    const fetchMock = mockFullPayloadFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAuxElementStatus(ANALYSIS_ID, 'complete'));

    await waitFor(() => {
      expect(result.current).toEqual({ description: true, channelMeta: true, comments: true });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('StrictMode double-invoke: a cancelled first attempt does NOT consume the guard — the second attempt fetches and lands (P2a)', async () => {
    // P2a regression: the guard used to be set BEFORE the fetch resolved, so
    // StrictMode's intentional double-invoke (mount → cleanup cancels the
    // in-flight fetch → remount sees the guard consumed and returns)
    // permanently suppressed the one legitimate refetch.
    useSynthesisNucleus.getState().setRawAnalysisPayload(LIVE_STUB as never, ANALYSIS_ID);
    let calls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.includes(`/api/analyses/${ANALYSIS_ID}`)) {
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      }
      calls += 1;
      if (calls === 1) {
        // The first (StrictMode-discarded) attempt never resolves — the
        // cleanup's `cancelled` flag means its eventual settle is ignored.
        return new Promise<Response>(() => {});
      }
      return Promise.resolve(
        new Response(JSON.stringify({ id: ANALYSIS_ID, analysis_payload: FULL_PAYLOAD }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAuxElementStatus(ANALYSIS_ID, 'complete'), {
      wrapper: StrictMode,
    });

    await waitFor(() => {
      expect(result.current).toEqual({ description: true, channelMeta: true, comments: true });
    });
    // The cancelled first attempt left the guard available, so the second
    // effect invocation actually fetched.
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes(ANALYSIS_ID))).toHaveLength(2);
    expect(useSynthesisNucleus.getState().rawAnalysisPayload).toEqual(FULL_PAYLOAD);
  });

  it('StrictMode double-invoke: a failed first attempt does NOT consume the guard — the second attempt retries and succeeds (P2a)', async () => {
    // P2a regression: a transient fetch failure used to leave the guard
    // consumed, permanently blocking the retry.
    useSynthesisNucleus.getState().setRawAnalysisPayload(LIVE_STUB as never, ANALYSIS_ID);
    let calls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.includes(`/api/analyses/${ANALYSIS_ID}`)) {
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      }
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new TypeError('network down'));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ id: ANALYSIS_ID, analysis_payload: FULL_PAYLOAD }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAuxElementStatus(ANALYSIS_ID, 'complete'), {
      wrapper: StrictMode,
    });

    await waitFor(() => {
      expect(result.current).toEqual({ description: true, channelMeta: true, comments: true });
    });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes(ANALYSIS_ID))).toHaveLength(2);
    expect(useSynthesisNucleus.getState().rawAnalysisPayload).toEqual(FULL_PAYLOAD);
  });

  it('StrictMode double-invoke with succeeding fetches stays bounded (exactly the double-invoke pair, no loop) (P2a)', async () => {
    useSynthesisNucleus.getState().setRawAnalysisPayload(LIVE_STUB as never, ANALYSIS_ID);
    const fetchMock = mockFullPayloadFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAuxElementStatus(ANALYSIS_ID, 'complete'), {
      wrapper: StrictMode,
    });

    await waitFor(() => {
      expect(result.current).toEqual({ description: true, channelMeta: true, comments: true });
    });
    await new Promise((settleTimer) => setTimeout(settleTimer, 25));
    // Two effect invocations fired two fetches; once one lands and consumes
    // the guard (and the payload is no longer the live stub), no further
    // fetches fire despite the store-driven effect re-runs.
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes(ANALYSIS_ID))).toHaveLength(2);
  });
});
