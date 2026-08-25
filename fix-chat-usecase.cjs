const fs = require('fs');
let file = fs.readFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', 'utf8');

// add import if missing
if (!file.includes('computeSimHash64')) {
  file = file.replace(
    /import \{ getChatGroundingInstructions \} from '@\/lib\/utils\/prompt-templates';/,
    "import { getChatGroundingInstructions } from '@/lib/utils/prompt-templates';\nimport { computeSimHash64 } from '@/lib/utils/simhash';"
  );
}

// replace the fallback block
const oldBlock = `    } else if (this.temporalGraph && conv.analysisId) {
      const subgraph = await this.temporalGraph.queryTemporalSubgraph({ analysisId: conv.analysisId });
      if (subgraph.length > 0) {
        const anchors = subgraph.map(n => \`[\${n.windowStart}s-\${n.windowEnd}s] \${n.salientClaim || n.verbatimAnchor || \`Temporal segment \${n.simhash64}\`}\`).join('\\n');
        transcriptSection = \`\\n\\n--- TEMPORAL GRAPH (Fallback) ---\\n\${anchors.slice(0, transcriptBudget)}\`;
      }
    }`;

const newBlock = `    } else if (this.temporalGraph && conv.analysisId) {
      const tokens = finalContent.split(/\\s+/).filter(Boolean);
      const queryHash = computeSimHash64(tokens);
      const matchedAnchors = await this.temporalGraph.resolveAnchorByHammingDistance({
        analysisId: conv.analysisId,
        queryHash,
        maxDistance: 12
      });

      if (matchedAnchors.length > 0) {
        const anchors = matchedAnchors.map(n => \`[\${n.windowStart}s-\${n.windowEnd}s] \${n.salientClaim || n.verbatimAnchor || \`Temporal segment \${n.simhash64}\`}\`).join('\\n');
        transcriptSection = \`\\n\\n--- TEMPORAL GRAPH (Semantic Matches) ---\\n\${anchors.slice(0, transcriptBudget)}\`;
      } else {
        const subgraph = await this.temporalGraph.queryTemporalSubgraph({ analysisId: conv.analysisId });
        if (subgraph.length > 0) {
          const anchors = subgraph.map(n => \`[\${n.windowStart}s-\${n.windowEnd}s] \${n.salientClaim || n.verbatimAnchor || \`Temporal segment \${n.simhash64}\`}\`).join('\\n');
          transcriptSection = \`\\n\\n--- TEMPORAL GRAPH (Fallback) ---\\n\${anchors.slice(0, transcriptBudget)}\`;
        }
      }
    }`;

file = file.replace(oldBlock, newBlock);
fs.writeFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', file);
