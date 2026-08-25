const fs = require('fs');
let file = fs.readFileSync('worker/src/services/LLMCascade.test.ts', 'utf8');
const i = file.indexOf("it('fails closed when");
if (i > 0) {
  file = file.substring(0, i);
  file += `it('fails closed when a claude-haiku-4.5 tier has no providerOrder at all', async () => {
    const cascade = new LLMCascade('test-api-key', undefined, [{ model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (no providerOrder)' }], { haiku: 8192, default: 16000 }, 'user1', 240000, 15000);
    
    // Attempting to stream should throw because buildRequestProvider fails
    await expect(cascade.streamCascade('sys', vi.fn())).rejects.toThrow('LLMCascade SSOT Violation: Haiku 4.5 requested without explicit providerOrder from Settings Registry');
  });
});
`;
  fs.writeFileSync('worker/src/services/LLMCascade.test.ts', file);
}
