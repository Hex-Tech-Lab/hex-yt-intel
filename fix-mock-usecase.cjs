const fs = require('fs');
let file = fs.readFileSync('web/lib/__tests__/executive-digest-usecase.test.ts', 'utf8');

// Insert vi.mock near the top of the file
if (!file.includes("vi.mock('@/lib/usecases/ReconcileHighlightsUseCase'")) {
  file = file.replace(/import \{ GenerateExecutiveDigestUseCase \} from '\.\.\/usecases\/GenerateExecutiveDigestUseCase';/, 
  `import { GenerateExecutiveDigestUseCase } from '../usecases/GenerateExecutiveDigestUseCase';\n\nvi.mock('@/lib/usecases/ReconcileHighlightsUseCase', () => ({\n  ReconcileHighlightsUseCase: vi.fn().mockImplementation(() => ({\n    execute: vi.fn().mockResolvedValue({ success: true, reconciledHighlights: [] })\n  }))\n}));`);
  fs.writeFileSync('web/lib/__tests__/executive-digest-usecase.test.ts', file);
}
