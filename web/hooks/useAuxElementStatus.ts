import { useEffect, useRef, useState } from 'react';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';

export interface AuxElementStatus {
  description: boolean;
  channelMeta: boolean;
  comments: boolean;
}

/**
 * Auxiliary element status badge derivation.
 * Checks live Synthesis Nucleus / Analysis store metadata first for instant
 * active status during both streaming and completed analyses, falling back
 * to stored API payload parameters.
 */
export function useAuxElementStatus(analysisId: string | null, status: string): AuxElementStatus | null {
  const [auxStatus, setAuxStatus] = useState<AuxElementStatus | null>(null);
  const fetchedForRef = useRef<string | null>(null);

  const videoMeta = useAnalysisStore((s) => s.videoMetadata);
  const nucleusPersona = useSynthesisNucleus((s) => s.personaConfig);
  const nucleusClass = useSynthesisNucleus((s) => s.classification);

  useEffect(() => {
    const vm = videoMeta as (typeof videoMeta & { description?: string }) | null;
    const hasDesc = Boolean(vm?.description || vm?.title);
    const hasChannel = Boolean(vm?.channelTitle || nucleusClass || nucleusPersona);
    const cCount = Number(vm?.commentCount ?? 0);
    const hasComments = Boolean(Number.isFinite(cCount) && cCount > 0);

    setAuxStatus({
      description: hasDesc,
      channelMeta: hasChannel,
      comments: hasComments,
    });
  }, [videoMeta, nucleusPersona, nucleusClass, status]);

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
          videoMetadata?: { description?: string; commentCount?: number | string };
          channelMeta?: Record<string, unknown> | null;
          comments?: unknown[] | null;
        };
        const report = (data.validation_report ?? {}) as {
          metadata?: { description?: string };
          channelMeta?: Record<string, unknown> | null;
          comments?: unknown[] | null;
        };

        const vm = videoMeta as (typeof videoMeta & { description?: string }) | null;
        const descStr =
          payload.metadata?.description ||
          payload.videoMetadata?.description ||
          report.metadata?.description ||
          vm?.description ||
          vm?.title ||
          '';

        const channelObj = payload.channelMeta || report.channelMeta || vm?.channelTitle || null;
        const cCount = Number(vm?.commentCount ?? 0);
        const commentsArr = Array.isArray(payload.comments)
          ? payload.comments
          : Array.isArray(report.comments)
          ? report.comments
          : (Number.isFinite(cCount) && cCount > 0 ? [1] : null);

        setAuxStatus({
          description: typeof descStr === 'string' && descStr.trim().length > 0,
          channelMeta: !!channelObj,
          comments: Array.isArray(commentsArr) && commentsArr.length > 0,
        });
      } catch (err) {
        console.debug('[useAuxElementStatus] fetch failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [analysisId, status, videoMeta]);

  return auxStatus;
}
