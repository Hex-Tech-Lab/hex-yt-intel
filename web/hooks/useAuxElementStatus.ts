import { useEffect, useRef, useState } from 'react';

export interface AuxElementStatus {
  description: boolean;
  channelMeta: boolean;
  comments: boolean;
}

/**
 * Wave A4 — auxiliary-element status row (post-Dimension-11 UI). Confirms
 * each *non-dimension* fetch succeeded (description, channel metadata,
 * comments), distinct from the 1-11 dimension dots. The digest chip reuses
 * useExecutiveDigest's existing `digest` state rather than refetching here.
 *
 * All three flags are already present in the same GET /api/analyses/[id]
 * response used by the restore flow (validation_report.metadata.description,
 * .channelMeta, .comments) -- no new server-side plumbing needed, just this
 * one read. Mirrors useExecutiveDigest's fetch-once-per-analysisId pattern.
 *
 * Known duplication, deliberately not optimized away here: for a RESTORED
 * analysis, useAutoRestoreAnalysis already fetches this exact endpoint and
 * stores the full validation_report on synthesis-nucleus's
 * `analysis.validation` at runtime (mergePayload passes it through
 * unmodified) -- but UCISPayload['validation'] is typed narrowly as
 * `{passed, errors, warnings}`, so reading channelMeta/comments off it would
 * mean either an undocumented `as any` cast or widening a shared type with
 * many other call sites. That's real surgery, not a quick win -- left as a
 * documented follow-up rather than done hastily. The extra fetch here is a
 * single low-frequency GET per completed-analysis view, same cost class as
 * useExecutiveDigest's already-accepted fetch.
 */
export function useAuxElementStatus(analysisId: string | null, status: string): AuxElementStatus | null {
  const [auxStatus, setAuxStatus] = useState<AuxElementStatus | null>(null);
  const fetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    setAuxStatus(null);
    fetchedForRef.current = null;
  }, [analysisId, status]);

  useEffect(() => {
    if (!analysisId || status !== 'complete') return;
    if (fetchedForRef.current === analysisId) return;
    fetchedForRef.current = analysisId;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/analyses/${analysisId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const payload = (data.analysis_payload ?? {}) as {
          metadata?: { description?: string };
          videoMetadata?: { description?: string };
          channelMeta?: Record<string, unknown> | null;
          comments?: unknown[] | null;
        };
        const report = (data.validation_report ?? {}) as {
          metadata?: { description?: string };
          channelMeta?: Record<string, unknown> | null;
          comments?: unknown[] | null;
        };

        const descStr =
          payload.metadata?.description ||
          payload.videoMetadata?.description ||
          report.metadata?.description ||
          '';

        const channelObj = payload.channelMeta || report.channelMeta || null;
        const commentsArr = Array.isArray(payload.comments)
          ? payload.comments
          : Array.isArray(report.comments)
          ? report.comments
          : null;

        setAuxStatus({
          description: typeof descStr === 'string' && descStr.trim().length > 0,
          channelMeta: !!channelObj && Object.keys(channelObj).length > 0,
          comments: Array.isArray(commentsArr) && commentsArr.length > 0,
        });
      } catch (err) {
        console.debug('[useAuxElementStatus] fetch failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [analysisId, status]);

  return auxStatus;
}
