const fs = require('fs');
let content = fs.readFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', 'utf8');

if (!content.includes('TemporalKnowledgePort')) {
  content = "import type { TemporalKnowledgePort } from '@/lib/ports/TemporalKnowledgePort';\n" + content;
  
  content = content.replace(
    /private knowledgeHistory: KnowledgeHistoryService\n  \) \{\}/,
    "private knowledgeHistory: KnowledgeHistoryService,\n    private temporalGraph?: TemporalKnowledgePort\n  ) {}"
  );
  
  const oldTranscriptSection = /    const transcriptSection = groundingData\.transcript\n      \? `\\n\\n--- TRANSCRIPT \\(timestamped where available\\) ---\\n\$\{groundingData\.transcript\.slice\(0, transcriptBudget\)\}`\n      : '';/;
  
  const newTranscriptSection = `    let transcriptSection = '';
    if (groundingData.transcript) {
      transcriptSection = \`\\n\\n--- TRANSCRIPT (timestamped where available) ---\\n\${groundingData.transcript.slice(0, transcriptBudget)}\`;
    } else if (this.temporalGraph && conv.analysisId) {
      // ADR 028: Temporal Graph Retrieval Fallback
      const subgraph = await this.temporalGraph.queryTemporalSubgraph({ analysisId: conv.analysisId });
      if (subgraph.length > 0) {
        const anchors = subgraph.map(n => \`[\${n.windowStart}s-\${n.windowEnd}s] \${n.salientClaim || n.verbatimAnchor || \`Temporal segment \${n.simhash64}\`}\`).join('\\n');
        transcriptSection = \`\\n\\n--- TEMPORAL GRAPH (Fallback) ---\\n\${anchors.slice(0, transcriptBudget)}\`;
      }
    }`;
    
  content = content.replace(oldTranscriptSection, newTranscriptSection);
  fs.writeFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', content);
  console.log('Chat updated');
} else {
  console.log('Already updated?');
}
