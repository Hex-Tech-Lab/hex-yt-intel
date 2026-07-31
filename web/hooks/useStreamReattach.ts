import { useEffect, useRef } from 'react';
import { startTransition } from 'react';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';
import type { AnalysisStatus } from '@/lib/types';

/**
 * Hook for Phase 2 Stream-Persistence Live SSE Re-Attach UX.
 * When an analysis is in 'analyzing' status on mount or tab return (e.g. after
 * navigating away during background execution), polls /api/analyses/[id]/status
 * to observe progress, stream terminal logs, and hydrate completed dimensions
 * without re-triggering an LLM cascade or double-charging.
 *
 * Gated on isLiveStreaming: 'analyzing' status is set both by a fresh
 * client-initiated stream (useSSEStream already owns live updates via SSE)
 * and by auto-restore detecting an in-progress background run (this hook's
 * actual job). Without the gate, this hook's 2.5s poll would also fire
 * during a live client stream and call initializeAnalysis/initSynthesis on
 * every tick, stomping the SSE-driven store state mid-stream.
 */
export function useStreamReattach(analysisId: string | null, status: AnalysisStatus, isLiveStreaming: boolean) {
  const lastCountRef = useRef<number>(-1);
  const setStatus = useAnalysisStore((s) => s.setStatus);
  const initializeAnalysis = useAnalysisStore((s) => s.initializeAnalysis);
  const logOk = useAnalysisStore((s) => s.logOk);
  const logError = useAnalysisStore((s) => s.logError);
  const logInfo = useAnalysisStore((s) => s.logInfo);
  const initSynthesis = useSynthesisNucleus((s) => s.initializeAnalysis);

  useEffect(() => {
    if (!analysisId || status !== 'analyzing' || isLiveStreaming) {
      lastCountRef.current = -1;
      return;
    }

    let cancelled = false;

    // Log re-attach message in processing log panel if not already logged
    const store = useAnalysisStore.getState();
    if (store.terminalLines.length === 0) {
      logInfo(`Re-attached to active background analysis (${analysisId.slice(0, 8)}...)`);
      logInfo('Listening for incoming dimension chunks from edge worker...');
    }

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/analyses/${analysisId}/status`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        const count = data.completedCount || 0;
        if (count > lastCountRef.current) {
          lastCountRef.current = count;

          startTransition(() => {
            if (data.analysisMarkdown) {
              initializeAnalysis(data.id, data.title, data.analysisMarkdown);

              const parsed = parseToUCISDimensions(data.analysisMarkdown);
              initSynthesis({
                id: data.id,
                videoId: data.videoId,
                title: data.title,
                dimensions: parsed,
              });

              if (count > 0) {
                logOk(`Received dimension chunk (${data.completedDimensions.join(', ')}) — ${count}/11 completed`);
              }
            }
          });
        }

        if (data.status === 'complete') {
          startTransition(() => {
            logOk('Background generation completed! All dimensions assembled.');
            setStatus('complete');
          });
        } else if (data.status === 'error') {
          startTransition(() => {
            logError('Background generation encountered an error or timed out.');
            setStatus('error');
          });
        }
      } catch (err) {
        console.debug('[useStreamReattach] Status poll failed:', err);
      }
    };

    // Initial poll immediately
    void pollStatus();

    // Poll every 2.5s while analyzing
    const timer = setInterval(() => {
      void pollStatus();
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [analysisId, status, isLiveStreaming, setStatus, initializeAnalysis, initSynthesis, logOk, logError, logInfo]);
}
