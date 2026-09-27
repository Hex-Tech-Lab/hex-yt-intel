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

      // Cheap pre-guard (RCA 2026-09-27, "swarm of gpt-oss-120b on groq"):
      // this usecase runs on EVERY cached-digest view (the digest early-return
      // path schedules it unconditionally), and each run fired a real LLM
      // completion even when every highlight already had a valid takeaway
      // link — so N digest polls = N paid model calls with zero effect.
      // Reconciliation's only write outcome is assigning takeawayIdx; when no
      // row is missing/out-of-range one, there is nothing to reconcile. Skip
      // the model call entirely in that case.
      const hasBrokenLinks = highlights.some(
        (h) => h.takeawayIdx === null || h.takeawayIdx === undefined || (h.takeawayIdx !== null && h.takeawayIdx !== undefined && (h.takeawayIdx < 0 || h.takeawayIdx >= takeaways.length))
      );
      if (!hasBrokenLinks) return;

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
