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

        // SSOT: mirrors get_user_history_overview's has_description/
        // has_channel_meta/has_comments EXACTLY (supabase/migrations/
        // 20260724100000_history_overview_function_v6_aux_status.sql) --
        // same source (validation_report only, never analysis_payload or
        // live videoMetadata/title fallbacks), same truthiness rules
        // (non-empty trimmed string / non-empty object / non-empty array).
        // Real bug, live-reported 2026-08-01: the History list (reading the
        // SQL function's strict truth) and this hook (previously falling
        // back to vm?.title / vm?.channelTitle / commentCount>0 as loose
        // stand-ins) disagreed for the SAME completed analysis -- History
        // correctly showed non-green chips, Synth Console incorrectly
        // showed all green. These two implementations MUST stay in
        // lockstep; if the SQL function's logic changes, update here too.
        const report = (data.validation_report ?? {}) as {
          metadata?: { description?: string };
          channelMeta?: Record<string, unknown> | null;
          comments?: unknown[] | null;
        };

        const descStr = report.metadata?.description ?? '';
        const hasDescription = typeof descStr === 'string' && descStr.trim().length > 0;
        const hasChannelMeta = Boolean(
          report.channelMeta &&
          typeof report.channelMeta === 'object' &&
          !Array.isArray(report.channelMeta) &&
          Object.keys(report.channelMeta).length > 0
        );
        const hasComments = Array.isArray(report.comments) && report.comments.length > 0;

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
