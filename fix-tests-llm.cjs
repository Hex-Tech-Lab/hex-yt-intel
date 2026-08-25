const fs = require('fs');
let file = fs.readFileSync('worker/src/services/LLMCascade.test.ts', 'utf8');

file = file.replace(/const cascade = new LLMCascade\('test-api-key', undefined, \[\{ model: 'model\/a', name: 'Model A' \}\]\);/, "const cascade = new LLMCascade('test-api-key', undefined, [{ model: 'model/a', name: 'Model A' }], { haiku: 8192, default: 16000 }, 'user1', 240000, 15000);");

file = file.replace(/const cascade = new LLMCascade\('test-api-key', undefined, \[\n\s*\{ model: 'model\/a', name: 'Model A' \},\n\s*\{ model: 'model\/b', name: 'Model B' \},\n\s*\]\);/, "const cascade = new LLMCascade('test-api-key', undefined, [{ model: 'model/a', name: 'Model A' }, { model: 'model/b', name: 'Model B' }], { haiku: 8192, default: 16000 }, 'user1', 240000, 15000);");

file = file.replace(/const cascade = new LLMCascade\('test-api-key', undefined, \[\n\s*\{\n\s*model: 'anthropic\/claude-haiku-4\.5',\n\s*name: 'Claude Haiku 4\.5 \(Azure\)',\n\s*providerOrder: \['azure'\],\n\s*\},\n\s*\]\);/, "const cascade = new LLMCascade('test-api-key', undefined, [{ model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (Azure)', providerOrder: ['azure'] }], { haiku: 8192, default: 16000 }, 'user1', 240000, 15000);");

file = file.replace(/it\('falls back to the hardcoded default provider order[\s\S]*?\}\);/m, 
`it('fails closed when a claude-haiku-4.5 tier has no providerOrder at all', async () => {
    const cascade = new LLMCascade('test-api-key', undefined, [{ model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (no providerOrder)' }], { haiku: 8192, default: 16000 }, 'user1', 240000, 15000);
    
    // Attempting to stream should throw because buildRequestProvider fails
    await expect(cascade.streamCascade('sys', vi.fn())).rejects.toThrow('LLMCascade SSOT Violation: Haiku 4.5 requested without explicit providerOrder from Settings Registry');
  });`);

fs.writeFileSync('worker/src/services/LLMCascade.test.ts', file);
