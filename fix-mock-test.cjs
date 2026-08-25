const fs = require('fs');
let file = fs.readFileSync('web/lib/__tests__/adr028-mock-purge-lifecycle.test.ts', 'utf8');

// replace description
file = file.replace(/describe\('ADR 028: 72-Hour Purge Lifecycle Simulation',/, "describe('ADR 028: Mock Purge Lifecycle Simulation',");

// fix tokenCrypto mock
file = file.replace(/signChatToken: vi.fn\(\)\.mockResolvedValue\('token'\)/, "signChatToken: vi.fn().mockResolvedValue({ sig: 'token', exp: 12345 })");

fs.writeFileSync('web/lib/__tests__/adr028-mock-purge-lifecycle.test.ts', file);
