const fs = require('fs');
let file = fs.readFileSync('web/lib/usecases/GenerateExecutiveDigestUseCase.ts', 'utf8');

file = file.replace(
  /import\('\.\/ReconcileHighlightsUseCase'\)\.then\(\(\{ ReconcileHighlightsUseCase \}\) => \{[\s\S]*?\}\);/,
  `const promise = import('./ReconcileHighlightsUseCase').then(({ ReconcileHighlightsUseCase }) => {
        return new ReconcileHighlightsUseCase(this.persistence, this.completion).execute({
          analysisId,
          userId,
          takeaways: parsed.takeaways!,
          models,
        });
      });
      // Expose for test teardown synchronization
      (this as any)._reconciliationPromise = promise;`
);

fs.writeFileSync('web/lib/usecases/GenerateExecutiveDigestUseCase.ts', file);
