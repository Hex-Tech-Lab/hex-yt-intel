/**
 * Radius-token contract test (user decision 2026-09-30).
 *
 * Parses web/app/globals.css and asserts the LAST @theme value of every
 * radius token matches the user-approved 8px/6px scale. The app shipped a
 * "Sprint 1" @theme block that overrode every token to 0px (everything went
 * right-angled); Tailwind v4 merges @theme blocks in declaration order, so
 * the LAST value wins — hence asserting the last occurrence, not the first.
 *
 * Negative control: re-introducing a 0px value in any later @theme block
 * fails this test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS_PATH = join(__dirname, '..', '..', 'app', 'globals.css');

/** Extracts the last value of each --radius-* token across all @theme blocks. */
function lastThemeRadiusValues(css: string): Map<string, string> {
  const blocks = [...css.matchAll(/@theme\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const values = new Map<string, string>();
  for (const block of blocks) {
    for (const match of block.matchAll(/--radius([a-z0-9-]*):\s*([^;]+);/g)) {
      values.set(`--radius${match[1] || ''}`, match[2].trim());
    }
  }
  return values;
}

const css = readFileSync(CSS_PATH, 'utf-8');
const values = lastThemeRadiusValues(css);

describe('radius tokens (globals.css @theme)', () => {
  it('resolves every token to the 8px/6px scale (last @theme block wins)', () => {
    const expected: Record<string, string> = {
      '--radius-control': '8px',
      '--radius-card': '8px',
      '--radius-pill': '6px',
      '--radius-xs': '4px',
      '--radius-sm': '6px',
      '--radius-md': '6px',
      '--radius-lg': '8px',
      '--radius-xl': '8px',
      '--radius-2xl': '8px',
      '--radius-3xl': '8px',
      '--radius': '6px',
    };
    for (const [token, want] of Object.entries(expected)) {
      expect(values.has(token), `${token} missing from @theme`).toBe(true);
      expect(values.get(token), `${token}`).toBe(want);
    }
  });

  it('never sets a radius token to 0px (negative control: Sprint-1 regression)', () => {
    for (const [token, value] of values) {
      expect(value, `${token} regressed to 0px`).not.toBe('0px');
    }
  });

  it('bridges Astryx theme radii to the app scale', () => {
    expect(css).toMatch(/--radius-inner:\s*var\(--radius-pill\)/);
    expect(css).toMatch(/--radius-element:\s*var\(--radius-control\)/);
    expect(css).toMatch(/--radius-container:\s*var\(--radius-card\)/);
    expect(css).toMatch(/--radius-chat:\s*var\(--radius-card\)/);
  });

  it(':root radius values stay in sync with @theme (direct var() consumers)', () => {
    expect(css).toMatch(/--radius-control:\s*8px/);
    expect(css).toMatch(/--radius-card:\s*8px/);
    expect(css).toMatch(/--radius-pill:\s*6px/);
  });
});
