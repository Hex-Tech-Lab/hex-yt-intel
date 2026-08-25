const fs = require('fs');
let file = fs.readFileSync('worker/src/services/LLMCascade.ts', 'utf8');

file = file.replace(/this\.llmHandshakeTimeoutMs = llmHandshakeTimeoutMs \?\? LLM_HANDSHAKE_TIMEOUT_MS_FALLBACK;/,
`if (!llmHandshakeTimeoutMs) throw new Error('LLMCascade SSOT Violation: Missing llmHandshakeTimeoutMs from Settings Registry');
    this.llmHandshakeTimeoutMs = llmHandshakeTimeoutMs;`);

file = file.replace(/this\.maxTokens = maxOutputTokens \?\? MAX_TOKENS_FALLBACK;/,
`if (!maxOutputTokens) throw new Error('LLMCascade SSOT Violation: Missing maxOutputTokens from Settings Registry');
    this.maxTokens = maxOutputTokens;`);

file = file.replace(/this\.llmTimeoutMs = llmTimeoutMs \?\? LLM_TIMEOUT_MS_FALLBACK;/,
`if (!llmTimeoutMs) throw new Error('LLMCascade SSOT Violation: Missing llmTimeoutMs from Settings Registry');
    this.llmTimeoutMs = llmTimeoutMs;`);

// Replace the chain logic
file = file.replace(/if \(cascade && cascade\.length > 0\) \{[\s\S]*?\} else \{[\s\S]*?this\.chain = MODEL_CHAIN;\n    \}/m,
`if (!cascade || cascade.length === 0) {
      throw new Error('LLMCascade SSOT Violation: Missing cascade configuration from Settings Registry');
    }
    this.chain = cascade;`);

fs.writeFileSync('worker/src/services/LLMCascade.ts', file);
