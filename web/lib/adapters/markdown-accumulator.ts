import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';

export class MarkdownAccumulator {
  private synthStore = useSynthesisNucleus;
  private analysisStore = useAnalysisStore;

  constructor() {}

  public rebuildDisplayMarkdown(force: boolean = false) {
    const store = this.analysisStore.getState();
    if (!store.analysis) return;
    const latestState = this.synthStore.getState();
    const allDimensions = Object.values(latestState.analysis?.dimensions || {}).sort((a, b) => a.number - b.number);
    
    const stitchedPayload = {
      persona: latestState.personaConfig || undefined,
      dimensions: allDimensions,
      classification: latestState.classification || undefined,
      monetizationVerdict: latestState.monetizationVerdict || undefined,
    };

    const reconstructed = reconstructMarkdown(stitchedPayload);
    const current = store.analysis.analysis_markdown || '';

    if (force || reconstructed.length >= current.length) {
      store.setAnalysis({
        ...store.analysis,
        analysis_markdown: reconstructed,
      });
    }
  }
}
