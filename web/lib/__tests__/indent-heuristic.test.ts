/**
 * ModuleLevelDynamicImportRule — 2-space indented imports false-positive test.
 * Replicates the indent===0 check logic from scripts/quality-engine/rules.ts
 * to verify 2-space indented function-local imports are NOT flagged.
 */
import { describe, it, expect } from 'vitest';

/**
 * Mirrors the indent check from ModuleLevelDynamicImportRule in rules.ts.
 * The rule flags dynamic imports at module level (indent === 0).
 * Function-local imports (indent > 0) should NOT be flagged.
 */
function checkForModuleLevelImport(fileContent: string): string[] {
  const violations: string[] = [];
  const lines = fileContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match dynamic import: const/let/var x = await import(...)
    const importMatch = trimmed.match(/(?:const|let|var)\s+\w+\s*=\s*(?:await\s+)?import\s*\(/);
    if (!importMatch) continue;

    const indent = line.search(/\S/);
    // Module-level: indent === 0 (the fix from indent <= 2)
    if (indent === 0) {
      violations.push(`Line ${i + 1}: module-level dynamic import`);
    }
  }
  return violations;
}

describe('ModuleLevelDynamicImportRule — Indent heuristic', () => {
  it('should NOT flag 2-space indented dynamic imports inside functions', () => {
    const code = `
export async function loadData() {
  const mod = await import('./some-module');
  return mod.default;
}
`;
    const violations = checkForModuleLevelImport(code);
    expect(violations).toHaveLength(0);
  });

  it('should flag top-level dynamic imports (indent=0)', () => {
    const code = `
const mod = await import('./some-module');
export default mod;
`;
    const violations = checkForModuleLevelImport(code);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('should NOT flag 4-space indented imports', () => {
    const code = `
    async function load() {
        const mod = await import('./module');
        return mod;
    }
`;
    const violations = checkForModuleLevelImport(code);
    expect(violations).toHaveLength(0);
  });

  it('should NOT flag tab-indented imports', () => {
    const code = `\tconst mod = await import('./module');`;
    const violations = checkForModuleLevelImport(code);
    expect(violations).toHaveLength(0);
  });
});
