import { useEffect } from 'react';
import { startTransition } from 'react';
import { extractVideoId } from '@/lib/youtube';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useChatStore } from '@/store/useChatStore';
import { useVideoStore } from '@/store/useVideoStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';
import { findMatchingConversation } from '@/lib/utils/find-chat-conversation';

/**
 * Auto-restores an already-analyzed video from cache when a URL is pasted.
 * Checks `/api/analyses/check` for an existing analysis for the extracted
 * video ID; if found, fetches the full record and hydrates the analysis,
 * synthesis nucleus, and chat stores exactly as the history-click restore
 * path does. Fires whenever `url` changes.
 */
export function useAutoRestoreAnalysis(url: string) {
  const initializeAnalysis = useAnalysisStore((s) => s.initializeAnalysis);
  const setVideoMetadata = useAnalysisStore((s) => s.setVideoMetadata);
  const setStatus = useAnalysisStore((s) => s.setStatus);
  const initSynthesis = useSynthesisNucleus((s) => s.initializeAnalysis);

  // Auto-restore already analyzed videos
  useEffect(() => { // skipcq: JS-0903
    if (!url) {
      // Only clear stores if there is no active loaded analysis in memory
      const hasActiveAnalysis = Boolean(
        useAnalysisStore.getState().videoMetadata?.videoId ||
        useSynthesisNucleus.getState().analysis?.videoId
      );
      if (!hasActiveAnalysis) {
        useAnalysisStore.getState().clearAnalysis();
        useSynthesisNucleus.getState().reset();
        useChatStore.getState().reset();
        useVideoStore.getState().reset();
      }
      return;
    }

    const videoId = extractVideoId(url);

    if (videoId === 'unknown' || videoId.length < 5) return;

    // A different video URL was pasted — drop the previous video's analysis data,
    // graphs, chat thread, and player state immediately so stale metadata and
    // dimensions never linger over the new context.
    const loadedVideoId =
      useAnalysisStore.getState().videoMetadata?.videoId ??
      useSynthesisNucleus.getState().analysis?.videoId;
    if (loadedVideoId && loadedVideoId !== videoId) {
      useAnalysisStore.getState().clearAnalysis();
      useSynthesisNucleus.getState().reset();
      useChatStore.getState().reset();
      useVideoStore.getState().reset();
    }

    let cancelled = false;

    // Check if there's already a completed analysis for this videoId
    void (async () => {
      try {
        let res;
        try {
          res = await fetch(`/api/analyses/check?videoId=${videoId}`);
        } finally {
          // resource cleanup
        }
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        if (data.exists && data.analysisId) {
          console.log('[AutoRestore] Existing analysis detected for video, fetching details:', data.analysisId);

          // Trigger the restoration flow just like history restoration
          let restoreRes;
          try {
            restoreRes = await fetch(`/api/analyses/${data.analysisId}`);
          } finally {
            // resource cleanup
          }
          if (!restoreRes.ok) return;
          const restoreData = await restoreRes.json();
          if (cancelled) return;

          let dimensions = parseToUCISDimensions(restoreData.analysis_markdown || '');

          // Fallback: if markdown parsing returned no dimensions but analysis_payload exists,
          // extract dimensions directly from the payload (handles cases where markdown
          // reconstruction failed due to payload size limits)
          if (Object.keys(dimensions).length === 0 && restoreData.analysis_payload?.dimensions) {
            const payloadDims = restoreData.analysis_payload.dimensions;
            if (Array.isArray(payloadDims)) {
              dimensions = payloadDims.reduce((acc: Record<number, typeof dimensions[1]>, d: { number?: number; name?: string; content?: string }) => {
                if (d && typeof d.number === 'number') {
                  acc[d.number] = { number: d.number, name: d.name || `Dimension ${d.number}`, content: d.content || '' };
                }
                return acc;
              }, {} as Record<number, typeof dimensions[1]>);
            }
          }

          const meta = restoreData.analysis_payload?.videoMetadata || restoreData.analysis_payload?.metadata || {};
          const duration = typeof meta.duration === 'number' ? meta.duration : typeof meta.lengthSeconds === 'number' ? Number(meta.lengthSeconds) : (restoreData.duration || 0);
          const viewCount = typeof meta.viewCount === 'number' ? meta.viewCount : typeof meta.view_count === 'number' ? Number(meta.view_count) : (restoreData.viewCount || 0);
          const likeCount = typeof meta.likeCount === 'number' ? meta.likeCount : typeof meta.like_count === 'number' ? Number(meta.like_count) : (restoreData.likeCount || 0);

          startTransition(() => {
            initializeAnalysis(restoreData.id, restoreData.title, restoreData.analysis_markdown);
            const currentMeta = useAnalysisStore.getState().videoMetadata;
            if (currentMeta?.videoId !== restoreData.videoId || !currentMeta?.duration) {
              setVideoMetadata({
                videoId: restoreData.videoId,
                title: restoreData.title,
                channelTitle: restoreData.channelTitle || meta.channelTitle || 'Unknown',
                publishedAt: meta.publishedAt || restoreData.analysisAt || restoreData.created_at || new Date().toISOString(),
                duration,
                viewCount,
                likeCount,
              } as any);
            }

            initSynthesis({
              id: restoreData.id,
              videoId: restoreData.videoId,
              title: restoreData.title,
              channelTitle: restoreData.channelTitle,
              model: restoreData.model,
              analysisAt: restoreData.analysisAt,
              detectedPersona: restoreData.detectedPersona,
              dimensions,
              validation: restoreData.validation_report,
              streaming: restoreData.streaming,
            });

            // Rehydrate the rich metadata stores (persona / knowledge graph /
            // classification / monetization) so restored graphs render real
            // content — matches the history-click restore path in AnalysisHistory.
            if (restoreData.analysis_payload) {
              const payload = restoreData.analysis_payload;
              const nucleus = useSynthesisNucleus.getState();
              if (payload.persona) nucleus.setPersonaConfig(payload.persona);
              if (payload.knowledgeGraph) nucleus.setKnowledgeGraph(payload.knowledgeGraph);
              if (payload.classification) nucleus.setClassification(payload.classification);
              if (payload.monetizationVerdict) nucleus.setMonetizationVerdict(payload.monetizationVerdict);
            }

            // Sync status to UI (either complete, error, partial, or processing/analyzing)
            if (data.status === 'processing' || restoreData.analysisStatus === 'incomplete') {
              setStatus('analyzing');
              const analysisStore = useAnalysisStore.getState();
              if (analysisStore.terminalLines.length === 0) {
                analysisStore.logInfo(`Re-attached to active background analysis (${restoreData.id.slice(0, 8)}...)`);
                analysisStore.logInfo(`Monitoring edge generator progress across ${restoreData.dimensionsReceived?.length || 0}/11 dimensions...`);
              }
            } else if (restoreData.analysisStatus === 'complete') {
              setStatus('complete');
            } else if (restoreData.analysisStatus === 'failed' || restoreData.analysisStatus === 'error') {
              setStatus('error');
            } else if (restoreData.analysisStatus === 'partial') {
              setStatus('complete'); // partial displays accordion with re-analyze banner
            } else {
              setStatus('idle');
            }
          });

          // Ground/Select the chat session in the background. Guarded by the
          // same `cancelled` flag the outer effect already uses (real bug,
          // live-reported 2026-08-01): this inner IIFE previously had no
          // ordering guard of its own, so a fast effect re-run (e.g. rapid
          // videoId changes) could let a stale lookup win the chat panel
          // after a newer one already resolved.
          void (async () => {
            try {
              if (cancelled) return;
              const chatStore = useChatStore.getState();
              await chatStore.loadConversations();
              if (cancelled) return;
              const existing = findMatchingConversation(chatStore.conversations, restoreData.id, restoreData.videoId);
              if (existing) {
                if (existing.analysisId !== restoreData.id) {
                  await chatStore.updateConversationAnalysisId(existing.id, restoreData.id);
                }
                if (cancelled) return;
                await chatStore.selectConversation(existing.id);
              } else if (!cancelled) {
                useChatStore.setState({ activeId: null });
              }
            } catch (e) {
              console.debug('[AutoRestore] Background chat session restoration failed:', e);
            }
          })();
        }
      } catch (err) {
        console.debug('[AutoRestore] Pre-flight cache check failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, initializeAnalysis, initSynthesis, setStatus, setVideoMetadata]);
}
