import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the /dashboard SSR 500: dashboard-panels.ts runs on the
 * server, so neither it nor any of its transitive dependencies (up to depth 3)
 * may import a module that begins with a 'use client' directive.
 *
 * WHAT IS CHECKED:
 * 1. Static and dynamic import specifiers, and require(...) calls in all modules
 *    starting from dashboard-panels.ts down to 3 levels deep.
 * 2. Both single-quoted ('...') and double-quoted ("...") module specifiers.
 * 3. Both aliased ('@/...') and relative ('./...', '../...') module specifiers.
 * 4. Purity validation: any resolved module file is inspected for a leading
 *    'use client' directive (allowing for comments / whitespace).
 * 5. Resolution strictness: any local '@/' specifier that cannot be resolved on
 *    disk FAILS the test immediately (no silent skipping).
 * 6. Negative controls proving the scanner detects direct client modules,
 *    a transitive client module behind a re-export bridge (temp fixture files run through the real scanner), double-quoted imports, require(...),
 *    dynamic import(...), and throws on unresolved '@/' aliases via a temp entry fixture.
 *
 * WHAT IS NOT CHECKED:
 * 1. External packages in node_modules (e.g. '@sentry/nextjs', '@supabase/ssr')
 *    and Node.js built-ins.
 * 2. Non-literal or dynamically-computed specifier strings (e.g. import(pathVariable)).
 * 3. Transitive dependency depth beyond 3 hops from dashboard-panels.ts.
 */
const root = resolve(__dirname, '../..');

export function extractModuleSpecs(src: string): string[] {
  const specs = new Set<string>();

  // Static: import ... from '...' / "..." or export ... from '...' / "..."
  for (const m of src.matchAll(/\b(?:import|export)\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g)) {
    if (m[1]) specs.add(m[1]);
  }
  // Bare static: import '...' / "..."
  for (const m of src.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) {
    if (m[1]) specs.add(m[1]);
  }
  // Dynamic: import('...') / import("...")
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (m[1]) specs.add(m[1]);
  }
  // CommonJS: require('...') / require("...")
  for (const m of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (m[1]) specs.add(m[1]);
  }

  return Array.from(specs);
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

export function resolveModulePath(spec: string, importerPath: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) {
    base = resolve(root, spec.replace('@/', ''));
  } else if (spec.startsWith('.')) {
    base = resolve(dirname(importerPath), spec);
  } else {
    // External package or built-in
    return null;
  }

  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    resolve(base, 'index.js'),
    base,
  ];
  return candidates.find(isFile) ?? null;
}

export function isClientModule(src: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(src);
}

export interface DependencyInspection {
  path: string;
  depth: number;
  isClient: boolean;
  history: string[];
}

export function collectTransitiveDependencies(
  entryFilePath: string,
  maxDepth = 3
): DependencyInspection[] {
  const visited = new Set<string>();
  const results: DependencyInspection[] = [];

  function traverse(currentPath: string, depth: number, chain: string[]) {
    if (depth > maxDepth || visited.has(currentPath)) return;
    visited.add(currentPath);

    const content = readFileSync(currentPath, 'utf8');
    const isClient = isClientModule(content);

    if (depth > 0) {
      results.push({
        path: currentPath,
        depth,
        isClient,
        history: chain,
      });
    }

    // If already at maxDepth, don't recurse deeper
    if (depth >= maxDepth) return;

    const specs = extractModuleSpecs(content);
    for (const spec of specs) {
      if (spec.startsWith('@/')) {
        const resolved = resolveModulePath(spec, currentPath);
        if (!resolved) {
          throw new Error(
            `Failed to resolve '@/' specifier '${spec}' imported from '${currentPath}'. Silent skipping is prohibited.`
          );
        }
        traverse(resolved, depth + 1, [...chain, `${spec} (${resolved})`]);
      } else if (spec.startsWith('.')) {
        const resolved = resolveModulePath(spec, currentPath);
        if (resolved) {
          traverse(resolved, depth + 1, [...chain, `${spec} (${resolved})`]);
        }
      }
    }
  }

  traverse(entryFilePath, 0, [entryFilePath]);
  return results;
}

describe('dashboard-panels server purity', () => {
  describe('negative controls', () => {
    it('detector flags a use-client module with single and double quotes, comments, and whitespace', () => {
      expect(isClientModule("'use client';\nexport const x = 1;")).toBe(true);
      expect(isClientModule('"use client";\nexport const x = 1;')).toBe(true);
      expect(isClientModule('// banner comment\n/* block */\n  "use client";\nexport const x = 1;')).toBe(true);
      expect(isClientModule('export const x = 1;')).toBe(false);
      expect(isClientModule('// just comment\nexport const x = 1;')).toBe(false);
    });

    it('extractModuleSpecs detects single, double-quoted, dynamic imports, and require(...) calls', () => {
      const sample = `
        import { a } from '@/lib/a';
        import { b } from "@/lib/b";
        import "@/lib/side-effect";
        export * from '@/lib/c';
        const dynamicMod = await import("@/lib/d");
        const cjsMod = require('@/lib/e');
      `;
      const specs = extractModuleSpecs(sample);
      expect(specs).toContain('@/lib/a');
      expect(specs).toContain('@/lib/b');
      expect(specs).toContain('@/lib/side-effect');
      expect(specs).toContain('@/lib/c');
      expect(specs).toContain('@/lib/d');
      expect(specs).toContain('@/lib/e');
    });

    it('unresolved @/ specifier throws an error instead of silently passing', () => {
      const dir = mkdtempSync(join(tmpdir(), 'purity-unresolved-'));
      try {
        const entryPath = join(dir, 'entry.ts');
        writeFileSync(entryPath, "import { missing } from '@/does/not/exist';\nexport const x = missing;\n");
        expect(() => {
          collectTransitiveDependencies(entryPath, 3);
        }).toThrow(/Failed to resolve '@\/' specifier '@\/does\/not\/exist'/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('transitive scanner flags a client module reached through a re-export bridge', () => {
      const dir = mkdtempSync(join(tmpdir(), 'purity-'));
      try {
        writeFileSync(join(dir, 'entry.ts'), "import { v } from './bridge';\nexport const e = v;\n");
        writeFileSync(join(dir, 'bridge.ts'), "export { v } from './client';\n");
        writeFileSync(join(dir, 'client.ts'), "'use client';\nexport const v = 1;\n");
        const deps = collectTransitiveDependencies(join(dir, 'entry.ts'), 3);
        const bridge = deps.find((d) => d.path.endsWith('bridge.ts'));
        const client = deps.find((d) => d.path.endsWith('client.ts'));
        expect(bridge?.isClient).toBe(false);
        expect(client?.isClient).toBe(true);
        expect(client?.depth).toBe(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('dashboard-panels.ts production purity', () => {
    it('imports no module marked use client directly or transitively up to depth 3', () => {
      const entryPath = resolve(__dirname, 'dashboard-panels.ts');
      const dependencies = collectTransitiveDependencies(entryPath, 3);

      expect(dependencies.length).toBeGreaterThan(0);

      // Verify that known safe dependencies are reached
      const paths = dependencies.map((dep) => dep.path);
      const typesModule = resolve(root, 'lib/types/dashboard-layout.ts');
      expect(paths).toContain(typesModule);

      // Invariant: NONE of the transitive dependencies up to depth 3 may be client modules
      for (const dep of dependencies) {
        expect(
          dep.isClient,
          `Server purity violation: module '${dep.path}' is marked 'use client' (reached via chain: ${dep.history.join(' -> ')})`
        ).toBe(false);
      }
    });
  });
});

