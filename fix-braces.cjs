const fs = require('fs');
let file = fs.readFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', 'utf8');

file = file.replace(/    \s*\}\n\}\n\}$/, '  }\n}');

fs.writeFileSync('web/lib/usecases/ExtractHighlightsUseCase.ts', file);
