import { useEffect, useRef, useState } from 'react';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { auxStatusFromAnalysisPayload } from '@/lib/utils/aux-status-from-report';
import type { AuxStatusPayloadInput } from '@/lib/utils/aux-status-from-report';

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

        // Cubic review, PR #178 (investigated, not applied): flagged that
        // rows with analysis_payload = null show every chip inactive with
        // no validation_report fallback. Checked live: the 32 real
        // completed/null-payload rows in prod are all June-era analyses
        // (validation_report.stale_after ~2026-06), predating the
        // channelMeta/comments features entirely (shipped 2026-07-24+) --
        // their validation_report.metadata only holds YouTube video stats
        // (title/duration/viewCount), never channelMeta/comments/
        // description. A fallback to validation_report would find nothing
        // for any of them; "all chips inactive" is the honest state for
        // these rows, not a bug. Not adding dead fallback code.
        const payload = data.analysis_payload as AuxStatusPayloadInput | null | undefined;
        const { hasDescription, hasChannelMeta, hasComments } = auxStatusFromAnalysisPayload(payload);

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
