const fs = require('fs');
let file = fs.readFileSync('web/lib/adapters/__tests__/temporal-graph-adapter.test.ts', 'utf8');

file = file.replace(/insert: vi\.fn\(\)\.mockResolvedValue\(\{ error: null \}\)/, "insert: vi.fn().mockResolvedValue({ error: null }),\n      upsert: vi.fn().mockResolvedValue({ error: null })");
file = file.replace(/targetSimHash:/, 'queryHash:');
file = file.replace(/expect\(res!\.id\)/, 'expect(res[0]!.id)');

fs.writeFileSync('web/lib/adapters/__tests__/temporal-graph-adapter.test.ts', file);

let digestFile = fs.readFileSync('web/lib/__tests__/digest-max-tokens-fallback-sync.test.ts', 'utf8');
digestFile = digestFile.replace(/@\/lib\/usecases\/GenerateExecutiveDigestUseCase\.ts/, '../usecases/GenerateExecutiveDigestUseCase.ts');
fs.writeFileSync('web/lib/__tests__/digest-max-tokens-fallback-sync.test.ts', digestFile);

