import { useEffect, useRef, useState } from 'react';
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
 * Checks live Synthesis Nucleus / Analysis store raw payload first for instant
 * active status during both streaming and restored analyses (sharing the canonical
 * `auxStatusFromAnalysisPayload` SSOT with History Overview list), falling back to
 * fetching stored API payload parameters when not present in memory.
 */
export function useAuxElementStatus(analysisId: string | null, status: string): AuxElementStatus | null {
  const [auxStatus, setAuxStatus] = useState<AuxElementStatus | null>(null);
  const fetchedForRef = useRef<string | null>(null);
  const rawPayload = useSynthesisNucleus((s) => s.rawAnalysisPayload);

  // Synchronous derivation from in-memory payload (streaming or restored)
  useEffect(() => {
    if (!analysisId) {
      setAuxStatus(null);
      fetchedForRef.current = null;
      return;
    }

    if (rawPayload) {
      const res = auxStatusFromAnalysisPayload(rawPayload);
      setAuxStatus({
        description: res.hasDescription,
        channelMeta: res.hasChannelMeta,
        comments: res.hasComments,
      });
    } else {
      // No payload in memory yet for THIS analysisId (switched to a
      // completed analysis whose payload hasn't been fetched, or the fetch
      // below hasn't resolved/failed) -- clear rather than leave the
      // PREVIOUS analysis's chip states on screen until/unless the fetch
      // effect below resolves (Cubic review, PR #214).
      setAuxStatus(null);
    }
  }, [analysisId, rawPayload]);

  // Fetch persisted payload if completed and not yet present in memory
  useEffect(() => {
    if (!analysisId || status !== 'complete') return;
    if (rawPayload) return; // Already present in memory
    if (fetchedForRef.current === analysisId) return;
    fetchedForRef.current = analysisId;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/analyses/${analysisId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        const payload = data.analysis_payload as AuxStatusPayloadInput | null | undefined;
        if (payload) {
          useSynthesisNucleus.getState().setRawAnalysisPayload(payload);
        }
        const mapped = auxStatusFromAnalysisPayload(payload);
        setAuxStatus({
          description: mapped.hasDescription,
          channelMeta: mapped.hasChannelMeta,
          comments: mapped.hasComments,
        });
      } catch (err) {
        console.debug('[useAuxElementStatus] fetch failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [analysisId, status, rawPayload]);

  return auxStatus;
}
