import { useEffect, useRef, useState } from 'react';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { auxStatusFromAnalysisPayload } from '@/lib/utils/aux-status-from-report';
import type { AuxStatusPayloadInput } from '@/lib/utils/aux-status-from-report';
import type { RestoreAnalysisPayload } from '@/lib/types/synthesis-nucleus';

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
function mapAuxStatus(payload: AuxStatusPayloadInput | null | undefined): AuxElementStatus {
  const res = auxStatusFromAnalysisPayload(payload);
  return {
    description: res.hasDescription,
    channelMeta: res.hasChannelMeta,
    comments: res.hasComments,
  };
}

export function useAuxElementStatus(analysisId: string | null, status: string): AuxElementStatus | null {
  const [auxStatus, setAuxStatus] = useState<AuxElementStatus | null>(null);
  const fetchedForRef = useRef<string | null>(null);
  const rawPayload = useSynthesisNucleus((s) => s.rawAnalysisPayload);
  const rawPayloadId = useSynthesisNucleus((s) => s.rawAnalysisPayloadId);
  // The store's rawAnalysisPayload is a single global slot, not keyed per
  // analysis -- only trust it when it's actually tagged as belonging to
  // THIS analysisId, otherwise it's either not-yet-loaded or leftover from
  // a different analysis that a reset somehow missed (Cubic review, PR #214).
  const payloadForThisAnalysis = analysisId && rawPayloadId === analysisId ? rawPayload : null;

  // Synchronous derivation from in-memory payload (streaming or restored)
  useEffect(() => {
    if (!analysisId) {
      setAuxStatus(null);
      fetchedForRef.current = null;
      return;
    }

    if (payloadForThisAnalysis) {
      setAuxStatus(mapAuxStatus(payloadForThisAnalysis));
    } else {
      // No payload in memory yet for THIS analysisId (switched to a
      // completed analysis whose payload hasn't been fetched, or the fetch
      // below hasn't resolved/failed) -- clear rather than leave the
      // PREVIOUS analysis's chip states on screen until/unless the fetch
      // effect below resolves (Cubic review, PR #214).
      setAuxStatus(null);
    }
  }, [analysisId, payloadForThisAnalysis]);

  // Fetch persisted payload if completed and not yet present in memory
  useEffect(() => {
    if (!analysisId || status !== 'complete') return;
    if (payloadForThisAnalysis) return; // Already present in memory
    if (fetchedForRef.current === analysisId) return;
    fetchedForRef.current = analysisId;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/analyses/${analysisId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        // `cancelled` (set true by this effect's own cleanup, which fires
        // before a re-run triggered by analysisId changing) already
        // protects against a stale response landing after the user has
        // switched to a different analysis -- explicit tag-with-analysisId
        // below is the second, store-level layer of that same protection.
        const payload = data.analysis_payload as RestoreAnalysisPayload | null | undefined;
        useSynthesisNucleus.getState().setRawAnalysisPayload(payload ?? null, analysisId);
        setAuxStatus(mapAuxStatus(payload));
      } catch (err) {
        console.debug('[useAuxElementStatus] fetch failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [analysisId, status, payloadForThisAnalysis]);

  return auxStatus;
}
