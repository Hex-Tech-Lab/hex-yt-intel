import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';

/** Count dimension headers (### DIMENSION N) in reconstructed markdown. */
function countDimensions(markdown: string): number {
  return (markdown.match(/^###\s+DIMENSION\s+\d+/gm) || []).length;
}

export class MarkdownAccumulator {
  private synthStore = useSynthesisNucleus;
  private analysisStore = useAnalysisStore;
  private markdownVersion = 0;

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

    if (force) {
      this.markdownVersion++;
      store.setAnalysis({
        ...store.analysis,
        analysis_markdown: reconstructed,
      });
    } else {
      // Compare dimension count (semantic freshness) instead of raw string length.
      // Length alone is a flawed proxy — a shorter corrected output can be more
      // accurate than a longer stale one. But when dimension counts are equal
      // (e.g. both 0 during empty state), preserve the longer content to prevent
      // empty reconstructions from overwriting substantive markdown.
      const currentDims = countDimensions(store.analysis.analysis_markdown || '');
      const newDims = countDimensions(reconstructed);
      const longerOrEqual = reconstructed.length >= (store.analysis.analysis_markdown || '').length;
      if (newDims > currentDims || (newDims === currentDims && longerOrEqual)) {
        this.markdownVersion++;
        store.setAnalysis({
          ...store.analysis,
          analysis_markdown: reconstructed,
        });
      }
    }
  }
}
