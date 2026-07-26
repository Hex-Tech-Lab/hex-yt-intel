import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredExecutiveDigest } from '@/lib/ports/ExecutiveDigestPorts';
import type { ExecutiveSummaryData } from '@/components/organisms/ExecutiveSummary';

/**
 * Dimension 0 — executive digest. Generated once (the cheap "#12 call") the
 * first time a completed, full analysis is viewed, then cached server-side, so
 * re-opening it returns the stored digest without re-spending. Also generated for
 * partial analyses so Synthesis Console is accessible for re-analysis.
 *
 * Retries `POST /api/analyses/digest` with backoff: the worker persists
 * analysis_markdown S2S *after* the client stream settles, so the first digest
 * call can race it and get a 409 (ERR_ANALYSIS_MARKDOWN_EMPTY). The route is
 * idempotent so extra retries are safe and cheap.
 */
export function useExecutiveDigest(analysisId: string | null, status: string) {
  const [digest, setDigest] = useState<StoredExecutiveDigest | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const digestFetchedForRef = useRef<string | null>(null);

  const mappedDigestData = useMemo<ExecutiveSummaryData | null>(() => {
    if (!digest) return null;
    return {
      overview: digest.overview ?? '',
      snapshot: digest.snapshot ?? '',
      keyTakeaways: digest.takeaways ?? [],
      detailedSummary: digest.detailedSummary ?? digest.overview ?? '',
    };
  }, [digest]);

  // Reset the card whenever we switch to a different analysis or re-analyze.
  useEffect(() => {
    if (status === 'analyzing' || status === 'downloading') {
      setDigest(null);
      setDigestLoading(false);
      digestFetchedForRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    setDigest(null);
    setDigestLoading(false);
    digestFetchedForRef.current = null;
  }, [analysisId]);

  useEffect(() => {
    if (!analysisId || status !== 'complete') return;
    if (digestFetchedForRef.current === analysisId) return;
    digestFetchedForRef.current = analysisId;

    let cancelled = false;
    let succeeded = false;
    setDigestLoading(true);
    // The worker persists analysis_markdown S2S *after* the client stream
    // settles, so the first digest call can race it and get a 409
    // (ERR_ANALYSIS_MARKDOWN_EMPTY). Retry with backoff until the markdown
    // lands; the route is idempotent so extra calls are safe and cheap.
    const RETRY_DELAYS_MS = [0, 3000, 5000, 8000, 13000, 21000];
    void (async () => {
      try {
        for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
          const delay = RETRY_DELAYS_MS[attempt];
          if (delay) await new Promise((r) => setTimeout(r, delay));
          if (cancelled) return;
          try {
            const res = await fetch('/api/analyses/digest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ analysisId }),
            });
            if (res.ok) {
              const data = await res.json();
              if (!cancelled && data?.digest) {
                setDigest(data.digest as StoredExecutiveDigest);
                succeeded = true;
              }
              return;
            }
            // 400/401/404 will never succeed on retry; 409 (markdown not yet
            // persisted) and 5xx (transient cascade failure) are retriable.
            if (res.status === 400 || res.status === 401 || res.status === 404) return;
            console.debug(`[digest] attempt ${attempt + 1} got ${res.status}; ${attempt < RETRY_DELAYS_MS.length - 1 ? 'retrying' : 'giving up'}`);
          } catch (err) {
            console.debug('[digest] generation request failed:', err);
          }
        }
      } finally {
        if (!cancelled) {
          // Exhausted or bailed without a digest — release the guard so a
          // later re-render (or analysis switch back) can try again.
          if (!succeeded && digestFetchedForRef.current === analysisId) {
            digestFetchedForRef.current = null;
          }
          setDigestLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      // Cancelled mid-flight without success (deps changed / unmount): release
      // the guard so the next effect run can re-request the digest.
      if (!succeeded && digestFetchedForRef.current === analysisId) {
        digestFetchedForRef.current = null;
      }
    };
    // NOTE: `partialInfo`-shaped derived data is intentionally NOT a dependency
    // here — it used to be included even though it was never read in the body,
    // which caused this effect (and its retry/backoff sequence) to restart on
    // every streaming-derived identity change. Only `status`/`analysisId`
    // control when a digest fetch should (re)start.
  }, [status, analysisId]);

  return { digest, digestLoading, mappedDigestData };
}
