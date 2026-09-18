import { describe, it, expect } from 'vitest';
import { resolveNextOutputMode, describeAmbiguousTargetWarning } from '../config/next-output-mode';

describe('resolveNextOutputMode (PR #317 round 2 — VERCEL-only fallback hardening)', () => {
  it('DEPLOY_TARGET=vercel (primary explicit signal) → no standalone', () => {
    const result = resolveNextOutputMode({ DEPLOY_TARGET: 'vercel', VERCEL: undefined });
    expect(result).toEqual({ output: undefined, source: 'explicit' });
  });

  it('DEPLOY_TARGET=vercel overrides even a stale VERCEL marker', () => {
    const result = resolveNextOutputMode({ DEPLOY_TARGET: 'vercel', VERCEL: '1' });
    expect(result).toEqual({ output: undefined, source: 'explicit' });
  });

  it('DEPLOY_TARGET=vercel is case/whitespace tolerant', () => {
    const result = resolveNextOutputMode({ DEPLOY_TARGET: '  Vercel  ' });
    expect(result).toEqual({ output: undefined, source: 'explicit' });
  });

  it('DEPLOY_TARGET=docker → standalone, explicit', () => {
    const result = resolveNextOutputMode({ DEPLOY_TARGET: 'docker' });
    expect(result).toEqual({ output: 'standalone', source: 'explicit' });
  });

  it('DEPLOY_TARGET=self-hosted → standalone, explicit', () => {
    const result = resolveNextOutputMode({ DEPLOY_TARGET: 'self-hosted' });
    expect(result).toEqual({ output: 'standalone', source: 'explicit' });
  });

  it('VERCEL=1 (documented fallback, no DEPLOY_TARGET) → no standalone', () => {
    const result = resolveNextOutputMode({ DEPLOY_TARGET: undefined, VERCEL: '1' });
    expect(result).toEqual({ output: undefined, source: 'vercel-fallback' });
  });

  it('VERCEL set to any truthy value → no standalone via fallback', () => {
    const result = resolveNextOutputMode({ VERCEL: 'yes' });
    expect(result).toEqual({ output: undefined, source: 'vercel-fallback' });
  });

  it('VERCEL unset and no DEPLOY_TARGET → standalone default (ambiguous)', () => {
    const result = resolveNextOutputMode({ DEPLOY_TARGET: undefined, VERCEL: undefined });
    expect(result).toEqual({ output: 'standalone', source: 'default' });
  });

  it('VERCEL explicitly cleared to empty string → treated as unset → standalone default', () => {
    const result = resolveNextOutputMode({ VERCEL: '' });
    expect(result).toEqual({ output: 'standalone', source: 'default' });
  });

  it('DEPLOY_TARGET set to empty/whitespace string is ignored → falls through to VERCEL fallback', () => {
    expect(resolveNextOutputMode({ DEPLOY_TARGET: '  ', VERCEL: '1' })).toEqual({
      output: undefined,
      source: 'vercel-fallback',
    });
    expect(resolveNextOutputMode({ DEPLOY_TARGET: '' })).toEqual({
      output: 'standalone',
      source: 'default',
    });
  });
});

describe('describeAmbiguousTargetWarning', () => {
  it('warns only when the target is ambiguous (default source)', () => {
    const warn = describeAmbiguousTargetWarning(resolveNextOutputMode({}));
    expect(warn).toBeTypeOf('string');
    expect(warn).toContain('DEPLOY_TARGET');
    expect(warn).toContain('standalone');
  });

  it('no warning for explicit or vercel-fallback sources', () => {
    expect(describeAmbiguousTargetWarning(resolveNextOutputMode({ DEPLOY_TARGET: 'vercel' }))).toBeNull();
    expect(describeAmbiguousTargetWarning(resolveNextOutputMode({ VERCEL: '1' }))).toBeNull();
  });
});
