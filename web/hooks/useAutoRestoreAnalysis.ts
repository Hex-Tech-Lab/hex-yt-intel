import { useEffect } from 'react';
import { startTransition } from 'react';
import { extractVideoId } from '@/lib/youtube';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useChatStore } from '@/store/useChatStore';
import { useVideoStore } from '@/store/useVideoStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';

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
    if (!url) return;

    const videoId = extractVideoId(url);

    if (videoId === 'unknown' || videoId.length < 5) return;

    // A different video URL was pasted — drop the previous video's chat thread
    // and player state immediately so stale conversation/messages and stale
    // isPlaying/seekTo never linger over the new context. Full reset() (not a
    // partial setState) matches the useSSEStream new-analysis path — a bare
    // `setState({ activeId: null })` here left `messagesByConv`/`conversations`
    // populated with the old video's data until the background restore below
    // happened to overwrite them (10X re-audit NEW-H(chat-clear)/NEW-H(state)).
    // The restore flow below re-selects the right thread if one exists.
    const loadedVideoId =
      useAnalysisStore.getState().videoMetadata?.videoId ??
      useSynthesisNucleus.getState().analysis?.videoId;
    if (loadedVideoId && loadedVideoId !== videoId) {
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

          startTransition(() => {
            initializeAnalysis(restoreData.id, restoreData.title, restoreData.analysis_markdown);
            setVideoMetadata({
              videoId: restoreData.videoId,
              title: restoreData.title,
              channelTitle: restoreData.channelTitle || 'Unknown',
              publishedAt: restoreData.analysisAt || restoreData.created_at || new Date().toISOString(),
              duration: restoreData.duration || 0,
              viewCount: restoreData.viewCount || 0,
              likeCount: restoreData.likeCount || 0,
            } as any);

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

            // Sync status to UI (either complete, error or partial)
            if (restoreData.analysisStatus === 'complete') {
              setStatus('complete');
            } else if (restoreData.analysisStatus === 'failed') {
              setStatus('error');
            } else if (restoreData.analysisStatus === 'partial') {
              setStatus('complete'); // partial displays accordion with re-analyze banner
            } else {
              setStatus('idle');
            }
          });

          // Ground/Select the chat session in the background
          void (async () => {
            try {
              const chatStore = useChatStore.getState();
              await chatStore.loadConversations();
              const existing = chatStore.conversations.find((c) =>
                c.analysisId === restoreData.id || c.videoId === restoreData.videoId
              );
              if (existing) {
                if (existing.analysisId !== restoreData.id) {
                  await chatStore.updateConversationAnalysisId(existing.id, restoreData.id);
                }
                await chatStore.selectConversation(existing.id);
              } else {
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
