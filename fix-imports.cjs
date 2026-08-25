const fs = require('fs');

let persistenceAdapter = fs.readFileSync('web/lib/adapters/SupabasePersistenceAdapter.ts', 'utf8');
persistenceAdapter = persistenceAdapter.replace(/HighlightData, /, '');
fs.writeFileSync('web/lib/adapters/SupabasePersistenceAdapter.ts', persistenceAdapter);

let execPort = fs.readFileSync('web/lib/ports/ExecutiveDigestPorts.ts', 'utf8');
execPort = execPort.replace(/import type { HighlightData } from '@\/lib\/types\/highlights';\n/, '');
fs.writeFileSync('web/lib/ports/ExecutiveDigestPorts.ts', execPort);

let extractUseCase = fs.readFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', 'utf8');
extractUseCase = extractUseCase.replace(/import type { HighlightData } from '@\/lib\/types\/highlights';\n/, '');
fs.writeFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', extractUseCase);

console.log('Fixed imports');
