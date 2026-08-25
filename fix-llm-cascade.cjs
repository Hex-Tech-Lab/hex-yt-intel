const fs = require('fs');
let file = fs.readFileSync('worker/src/services/LLMCascade.ts', 'utf8');

// Remove hardcoded imports
file = file.replace(/import \{ CASCADE_FALLBACKS \} from '\.\.\/\.\.\/\.\.\/web\/lib\/config\/cascade';\n/, '');
file = file.replace(/\/\/ Deploy-time snapshot[\s\S]*?const MODEL_CHAIN = CASCADE_FALLBACKS\.analysis;\n/, '');

// Remove fallbacks
file = file.replace(/const MAX_TOKENS_FALLBACK = \{ haiku: 8192, default: 16000 \};\n/, '');
file = file.replace(/const LLM_TIMEOUT_MS_FALLBACK = 240000;\n/, '');
file = file.replace(/const LLM_HANDSHAKE_TIMEOUT_MS_FALLBACK = 15000;\n/, '');
file = file.replace(/\/\/ Defensive fallback ONLY[\s\S]*?const HAIKU_PROVIDER_ORDER_FALLBACK = \['google-vertex', 'azure', 'anthropic', 'amazon-bedrock'\];\n/, '');

// Fix buildRequestProvider
file = file.replace(/function buildRequestProvider\([\s\S]*?\}\n\nexport class/m, 
`function buildRequestProvider(
  isHaiku45: boolean,
  providerOrder: string[] | undefined
): { order: string[]; allow_fallbacks: false } | undefined {
  if (isHaiku45) {
    if (!providerOrder || providerOrder.length === 0) {
      throw new Error('LLMCascade SSOT Violation: Haiku 4.5 requested without explicit providerOrder from Settings Registry');
    }
    return {
      order: providerOrder,
      allow_fallbacks: false,
    };
  }
  return providerOrder && providerOrder.length > 0 ? { order: providerOrder, allow_fallbacks: false } : undefined;
}

export class`);

fs.writeFileSync('worker/src/services/LLMCascade.ts', file);
