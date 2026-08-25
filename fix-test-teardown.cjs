const fs = require('fs');
let file = fs.readFileSync('web/lib/__tests__/executive-digest-usecase.test.ts', 'utf8');

if (!file.includes('afterEach')) {
  file = file.replace(/describe\('GenerateExecutiveDigestUseCase', \(\) => \{/, "describe('GenerateExecutiveDigestUseCase', () => {\n  let useCase: GenerateExecutiveDigestUseCase;\n  afterEach(async () => {\n    if (useCase && (useCase as any)._reconciliationPromise) {\n      await (useCase as any)._reconciliationPromise.catch(() => {});\n    }\n  });");
  
  // replace all 'const usecase =' with 'useCase ='
  file = file.replace(/const useCase =/g, 'useCase =');
  fs.writeFileSync('web/lib/__tests__/executive-digest-usecase.test.ts', file);
}
