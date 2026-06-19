import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';

export class MarkdownAccumulator {
  private synthStore = useSynthesisNucleus;
  private analysisStore = useAnalysisStore;

  constructor() {}

  public rebuildDisplayMarkdown() {
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

    // Allow the reconstructed markdown to replace the previous content unconditionally.
    // During a fallback reset, a different model may produce shorter but valid output.
    store.setAnalysis({
      ...store.analysis,
      analysis_markdown: reconstructed,
    });
  }
}
