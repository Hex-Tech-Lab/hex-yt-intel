const fs = require('fs');
let file = fs.readFileSync('worker/src/services/LLMCascade.test.ts', 'utf8');

// Replace instantiation
file = file.replace(/new LLMCascade\([\s\S]*?\)/g, (match) => {
  if (match.includes("'sk-test'")) {
    const defaultArgs = "'sk-test', [], [{ model: 'anthropic/claude-haiku-4.5', name: 'claude-haiku-4.5', providerOrder: ['azure', 'anthropic'] }], { haiku: 8192, default: 16000 }, 'user-1', 240000, 15000";
    if (match.includes('cascadeOverride')) {
      return "new LLMCascade('sk-test', undefined, cascadeOverride, { haiku: 8192, default: 16000 }, 'user-1', 240000, 15000)";
    }
    return `new LLMCascade(${defaultArgs})`;
  }
  return match;
});

// For test 2, the `cascadeOverride` is used.
file = file.replace(/const cascadeOverride = \[\n\s*\{ model: 'fail-model', name: 'fail-model' \},\n\s*\{ model: 'success-model', name: 'success-model' \}\n\s*\];/m, 
`const cascadeOverride = [
      { model: 'fail-model', name: 'fail-model', providerOrder: ['azure'] },
      { model: 'success-model', name: 'success-model', providerOrder: ['azure'] }
    ];`);

// Replace test 4 which expected fallback
file = file.replace(/it\('falls back to the hardcoded default provider order[\s\S]*?\}\);/m, 
`it('fails closed when a claude-haiku-4.5 tier has no providerOrder at all', async () => {
    const cascadeOverride = [{ model: 'anthropic/claude-haiku-4.5', name: 'claude-haiku-4.5' }];
    const cascade = new LLMCascade('sk-test', undefined, cascadeOverride, { haiku: 8192, default: 16000 }, 'user-1', 240000, 15000);
    
    // Attempting to stream should throw because buildRequestProvider fails
    await expect(cascade.streamCascade('sys', vi.fn())).rejects.toThrow('LLMCascade SSOT Violation: Haiku 4.5 requested without explicit providerOrder from Settings Registry');
  });`);

fs.writeFileSync('worker/src/services/LLMCascade.test.ts', file);
