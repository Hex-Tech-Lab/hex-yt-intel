const fs = require('fs');
let route = fs.readFileSync('web/app/api/webhooks/highlights/route.ts', 'utf8');

if (!route.includes('SupabaseTemporalGraphAdapter')) {
  route = "import { SupabaseTemporalGraphAdapter } from '@/lib/adapters/SupabaseTemporalGraphAdapter';\n" + route;
  route = route.replace(
    /const useCase = new ExtractHighlightsUseCase\([\s\S]*?new OpenRouterCompletionAdapter\(\)[\s\S]*?\);/,
    "const useCase = new ExtractHighlightsUseCase(\n      new SupabasePersistenceAdapter(),\n      new OpenRouterCompletionAdapter(),\n      new SupabaseTemporalGraphAdapter()\n    );"
  );
  fs.writeFileSync('web/app/api/webhooks/highlights/route.ts', route);
}
console.log('Route updated');
