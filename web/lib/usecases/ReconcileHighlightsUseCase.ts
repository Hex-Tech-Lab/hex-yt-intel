import { TextCompletionPort } from '@/lib/ports/ExecutiveDigestPorts';
import { DigestPersistencePort } from '@/lib/ports/ExecutiveDigestPorts';
import { buildHighlightsReconciliationSystemPrompt, buildHighlightsReconciliationUserMessage, parseHighlightsReconciliation } from '@/lib/prompts/highlights-reconciliation';

export class ReconcileHighlightsUseCase {
  constructor(
    private persistence: DigestPersistencePort,
    private completion: TextCompletionPort
  ) {}

  async execute(params: { analysisId: string; userId: string; takeaways: string[]; models: readonly any[] }) {
    const { analysisId, takeaways, models } = params;
    if (takeaways.length === 0) return;

    try {
      const highlights = await this.persistence.findHighlightsForAnalysis(analysisId);
      if (highlights.length === 0) return;

      const completion = await this.completion.complete({
        system: buildHighlightsReconciliationSystemPrompt(),
        user: buildHighlightsReconciliationUserMessage(takeaways, highlights as any),
        models,
        maxTokens: 500,
        analysisId,
      });

      const result = parseHighlightsReconciliation(completion.text, takeaways.length, highlights.length);
      if (result.status === 'invalid') return;

      // Update highlights with their new takeaway mapping
      const updatedHighlights = [...highlights];
      for (const t of result.reconciliation.takeaways) {
        if (t.grounded && t.backingHighlightIdx !== null && updatedHighlights[t.backingHighlightIdx]) {
          updatedHighlights[t.backingHighlightIdx]!.takeawayIdx = t.idx;
        }
      }

      await Promise.all([
        this.persistence.saveReconciliation({ analysisId, reconciliation: result.reconciliation }),
        this.persistence.saveHighlights({ analysisId, highlights: updatedHighlights })
      ]);
      
      console.log(`[reconcile-highlights] Reconciled analysis ${analysisId}`);
    } catch (e) {
      console.warn('[reconcile-highlights] Reconciliation failed silently', e);
    }
  }
}
