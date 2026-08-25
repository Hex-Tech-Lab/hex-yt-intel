const fs = require('fs');

// 1. ProcessChatMessageUseCase
let pc = fs.readFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', 'utf8');
pc = "import type { TemporalKnowledgePort } from '@/lib/ports/TemporalKnowledgePort';\n" + pc;
pc = pc.replace(
  /private knowledgeHistory: KnowledgeHistoryService\n  \) \{\}/,
  "private knowledgeHistory: KnowledgeHistoryService,\n    private temporalGraph?: TemporalKnowledgePort\n  ) {}"
);
const oldTranscriptSection = /    const transcriptSection = groundingData\.transcript\n      \? `\\n\\n--- TRANSCRIPT \\(timestamped where available\\) ---\\n\$\{groundingData\.transcript\.slice\(0, transcriptBudget\)\}`\n      : '';/;
const newTranscriptSection = `    let transcriptSection = '';
    if (groundingData.transcript) {
      transcriptSection = \`\\n\\n--- TRANSCRIPT (timestamped where available) ---\\n\${groundingData.transcript.slice(0, transcriptBudget)}\`;
    } else if (this.temporalGraph && conv.analysisId) {
      const subgraph = await this.temporalGraph.queryTemporalSubgraph({ analysisId: conv.analysisId });
      if (subgraph.length > 0) {
        const anchors = subgraph.map(n => \`[\${n.windowStart}s-\${n.windowEnd}s] \${n.salientClaim || n.verbatimAnchor || \`Temporal segment \${n.simhash64}\`}\`).join('\\n');
        transcriptSection = \`\\n\\n--- TEMPORAL GRAPH (Fallback) ---\\n\${anchors.slice(0, transcriptBudget)}\`;
      }
    }`;
pc = pc.replace(oldTranscriptSection, newTranscriptSection);
fs.writeFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', pc);


// 2. ExtractHighlightsUseCase
let eh = fs.readFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', 'utf8');
eh = "import type { TemporalKnowledgePort } from '@/lib/ports/TemporalKnowledgePort';\nimport { computeSimHash64 } from '@/lib/utils/simhash';\n" + eh;
eh = eh.replace(
  /private completion: TextCompletionPort\n  \) \{\}/,
  "private completion: TextCompletionPort,\n    private temporalGraph?: TemporalKnowledgePort\n  ) {}"
);

// We need to inject after saveHighlights
eh = eh.replace(
  /        verbatimExcerpt: buildVerbatimExcerpt\(highlight\.start, highlight\.end, segments\),\n      \}\)\),\n    \}\);/,
  `        verbatimExcerpt: buildVerbatimExcerpt(highlight.start, highlight.end, segments),
      })),
    });

    if (this.temporalGraph && segments.length > 0) {
      const anchors = [];
      const windowSize = 30;
      const maxTime = segments[segments.length - 1]?.start || 0;
      for (let windowStart = 0; windowStart <= maxTime; windowStart += windowSize) {
        const windowEnd = windowStart + windowSize;
        const windowSegments = segments.filter(s => s.start >= windowStart && s.start < windowEnd);
        if (windowSegments.length > 0) {
          const tokens = windowSegments.map(s => s.text).join(' ').split(/\\s+/).filter(Boolean);
          const simhash64 = computeSimHash64(tokens);
          anchors.push({ windowStart, windowEnd, simhash64, salientClaim: null, verbatimAnchor: null });
        }
      }
      if (anchors.length > 0) {
        await this.temporalGraph.storeSimHashAnchors({ analysisId, anchors });
      }
    }`
);
fs.writeFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', eh);

// 3. chat route
let route = fs.readFileSync('web/app/api/chat/conversations/[id]/messages/route.ts', 'utf8');
route = route.replace(
  /const useCase = new ProcessChatMessageUseCase\(\n      chatPersistence,\n      modelResolution,\n      tokenCrypto,\n      knowledgeHistory\n    \);/,
  "const useCase = new ProcessChatMessageUseCase(\n      chatPersistence,\n      modelResolution,\n      tokenCrypto,\n      knowledgeHistory,\n      new SupabaseTemporalGraphAdapter()\n    );"
);
fs.writeFileSync('web/app/api/chat/conversations/[id]/messages/route.ts', route);

console.log('Fixed clean');
