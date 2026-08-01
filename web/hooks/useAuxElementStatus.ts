import { useEffect, useRef, useState } from 'react';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { auxStatusFromValidationReport, type AuxStatusReportInput } from '@/lib/utils/aux-status-from-report';

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

        const report = data.validation_report as AuxStatusReportInput | null | undefined;
        const { hasDescription, hasChannelMeta, hasComments } = auxStatusFromValidationReport(report);

        setAuxStatus({
          description: hasDescription,
          channelMeta: hasChannelMeta,
          comments: hasComments,
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
