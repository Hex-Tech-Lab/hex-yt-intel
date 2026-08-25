const fs = require('fs');

// 1. AnalysisPersistencePort.ts
let analysisPort = fs.readFileSync('web/lib/ports/AnalysisPersistencePort.ts', 'utf8');
analysisPort = "import type { HighlightData } from '@/lib/types/highlights';\n" + analysisPort;
analysisPort = analysisPort.replace(
  /findHighlightsForAnalysis\(analysisId: string\): Promise<Array<{\s*idx: number;\s*start: number;\s*end: number;\s*label: string;\s*takeawayIdx: number \| null;\s*verbatimExcerpt: string \| null;\s*}>>;/g,
  "findHighlightsForAnalysis(analysisId: string): Promise<HighlightData[]>;"
);
fs.writeFileSync('web/lib/ports/AnalysisPersistencePort.ts', analysisPort);

// 2. ChatPersistencePort.ts
let chatPort = fs.readFileSync('web/lib/ports/ChatPersistencePort.ts', 'utf8');
chatPort = "import type { AnalysisGroundingData } from '@/lib/types/highlights';\n" + chatPort;
chatPort = chatPort.replace(
  /getAnalysisGrounding\(params: {\s*analysisId: string;\s*\/\*\* When provided, the analysis must belong to this user or null is returned\. \*\/\s*userId\?: string;\s*}\): Promise<{[\s\S]*?} \| null>;/g,
  "getAnalysisGrounding(params: { analysisId: string; userId?: string }): Promise<AnalysisGroundingData | null>;"
);
fs.writeFileSync('web/lib/ports/ChatPersistencePort.ts', chatPort);

// 3. SupabaseAnalysisAdapter.ts
let analysisAdapter = fs.readFileSync('web/lib/adapters/SupabaseAnalysisAdapter.ts', 'utf8');
analysisAdapter = "import type { HighlightData, AnalysisGroundingData } from '@/lib/types/highlights';\n" + analysisAdapter;
analysisAdapter = analysisAdapter.replace(
  /static async getAnalysisGrounding\(params: {\s*analysisId: string;\s*userId\?: string;\s*}\): Promise<{[\s\S]*?} \| null> {/g,
  "static async getAnalysisGrounding(params: { analysisId: string; userId?: string }): Promise<AnalysisGroundingData | null> {"
);
analysisAdapter = analysisAdapter.replace(
  /static async findHighlightsForAnalysis\(analysisId: string\): Promise<Array<{\s*idx: number;\s*start: number;\s*end: number;\s*label: string;\s*takeawayIdx: number \| null;\s*verbatimExcerpt: string \| null;\s*}>> {/g,
  "static async findHighlightsForAnalysis(analysisId: string): Promise<HighlightData[]> {"
);
fs.writeFileSync('web/lib/adapters/SupabaseAnalysisAdapter.ts', analysisAdapter);

// 4. SupabasePersistenceAdapter.ts
let persistenceAdapter = fs.readFileSync('web/lib/adapters/SupabasePersistenceAdapter.ts', 'utf8');
persistenceAdapter = "import type { HighlightData, AnalysisGroundingData } from '@/lib/types/highlights';\n" + persistenceAdapter;
persistenceAdapter = persistenceAdapter.replace(
  /getAnalysisGrounding\(params: { analysisId: string; userId\?: string }\): Promise<{[\s\S]*?} \| null> {/g,
  "getAnalysisGrounding(params: { analysisId: string; userId?: string }): Promise<AnalysisGroundingData | null> {"
);
persistenceAdapter = persistenceAdapter.replace(
  /findHighlightsForAnalysis\(analysisId: string\): Promise<Array<{\s*idx: number;\s*start: number;\s*end: number;\s*label: string;\s*takeawayIdx: number \| null;\s*verbatimExcerpt: string \| null;\s*}>> {/g,
  "findHighlightsForAnalysis(analysisId: string): Promise<HighlightData[]> {"
);
fs.writeFileSync('web/lib/adapters/SupabasePersistenceAdapter.ts', persistenceAdapter);

// 5. ExecutiveDigestPorts.ts
let execPort = fs.readFileSync('web/lib/ports/ExecutiveDigestPorts.ts', 'utf8');
if (!execPort.includes("import type { HighlightData }")) {
  execPort = "import type { HighlightData } from '@/lib/types/highlights';\n" + execPort;
}
execPort = execPort.replace(
  /Array<{\s*idx: number;\s*start: number;\s*end: number;\s*label: string;\s*takeawayIdx\?: number \| null;\s*verbatimExcerpt\?: string \| null;\s*}>/g,
  "HighlightData[]"
);
execPort = execPort.replace(
  /Array<{\s*idx: number;\s*start: number;\s*end: number;\s*label: string;\s*takeawayIdx: number \| null;\s*verbatimExcerpt: string \| null;\s*}>/g,
  "HighlightData[]"
);
fs.writeFileSync('web/lib/ports/ExecutiveDigestPorts.ts', execPort);

// 6. ExtractHighlightsUseCase.ts
let extractUseCase = fs.readFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', 'utf8');
if (!extractUseCase.includes("import type { HighlightData }")) {
  extractUseCase = "import type { HighlightData } from '@/lib/types/highlights';\n" + extractUseCase;
}
extractUseCase = extractUseCase.replace(
  /Array<{\s*idx: number;\s*start: number;\s*end: number;\s*label: string;\s*takeawayIdx\?: number \| null;\s*verbatimExcerpt\?: string;\s*}>/g,
  "HighlightData[]"
);
fs.writeFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', extractUseCase);

console.log('Types replaced successfully');
