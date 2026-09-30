import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// #377 review: GlowBorder's inner wrapper must follow the SELECTED radius, not
// always the card radius (a control-radius GlowBorder would otherwise clip).
// Source-level check: happy-dom drops calc(var(...)) values from inline styles.
describe('GlowBorder inner radius', () => {
  it('derives the inner radius from the same token as the outer radius', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'components', 'templates', '_shared', 'primitives.tsx'), 'utf-8');
    const glow = source.match(/export function GlowBorder[\s\S]*?\n}\n/)?.[0] ?? '';
    expect(glow).toContain('borderRadius: `calc(${computedRadius} - 1px)`');
    expect(glow).not.toContain('calc(var(--radius-card) - 1px)');
  });
});
