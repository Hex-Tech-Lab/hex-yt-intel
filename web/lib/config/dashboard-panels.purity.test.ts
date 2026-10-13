import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression for the /dashboard SSR 500: dashboard-panels.ts runs on the
 * server, so it must never import (transitively, one hop) a module that
 * starts with a 'use client' directive.
 */
const root = resolve(__dirname, '../..');

function localImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+'(@\/[^']+)'/g)) out.push(m[1]);
  return out;
}

function resolveAlias(spec: string): string | null {
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    try {
      const p = resolve(root, spec.slice(2) + ext);
      readFileSync(p, 'utf8');
      return p;
    } catch {
      /* try next extension */
    }
  }
  return null;
}

export function isClientModule(src: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(src);
}

describe('dashboard-panels server purity', () => {
  it('detector flags a use-client module (negative control)', () => {
    expect(isClientModule("'use client';\nexport const x = 1;")).toBe(true);
    expect(isClientModule('export const x = 1;')).toBe(false);
  });

  it('imports no module marked use client', () => {
    const entry = readFileSync(resolve(__dirname, 'dashboard-panels.ts'), 'utf8');
    const specs = localImports(entry);
    expect(specs.length).toBeGreaterThan(0);
    expect(specs).toContain('@/lib/types/dashboard-layout');
    for (const spec of specs) {
      const path = resolveAlias(spec);
      if (!path) continue;
      expect(isClientModule(readFileSync(path, 'utf8')), spec).toBe(false);
    }
  });
});
