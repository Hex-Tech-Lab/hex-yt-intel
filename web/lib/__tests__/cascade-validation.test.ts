import { describe, it, expect } from 'vitest';
import {
  validateCascadeRegistryValue,
  CASCADE_REGISTRY_VALIDATION_MARKER,
} from '@/lib/config/cascade-validation';
import { CASCADE_MODEL_ALLOWLIST, CASCADE_FALLBACKS } from '@/lib/config/cascade';

describe('validateCascadeRegistryValue (ADR 040)', () => {
  it('accepts every fallback cascade verbatim (the shipped defaults must save)', () => {
    for (const [name, cascade] of Object.entries(CASCADE_FALLBACKS)) {
      expect(validateCascadeRegistryValue(cascade), name).toBeNull();
    }
  });

  it('accepts every model in the code allowlist when built into a valid tier', () => {
    for (const model of CASCADE_MODEL_ALLOWLIST) {
      const value = [{ model, name: `Test tier for ${model}` }];
      expect(validateCascadeRegistryValue(value), model).toBeNull();
    }
  });

  it('rejects an unknown model ID (the claude-3-5-haiku injection from the 10X scan)', () => {
    const err = validateCascadeRegistryValue([{ model: 'claude-3-5-haiku', name: 'Injected' }]);
    expect(err).toMatch(/Unknown model ID "claude-3-5-haiku"/);
  });

  it('rejects malformed shapes', () => {
    expect(validateCascadeRegistryValue([{ model: '', name: 'x' }])).toMatch(/Invalid cascade tier/);
    expect(validateCascadeRegistryValue([{ model: 'openai/gpt-oss-120b', name: '' }])).toMatch(/Invalid cascade tier/);
    expect(validateCascadeRegistryValue([{ model: 'openai/gpt-oss-120b', name: 'x', cost: -1 }])).toMatch(/Invalid cascade tier/);
    expect(validateCascadeRegistryValue([{ model: 'openai/gpt-oss-120b', name: 'x', providerOrder: [''] }])).toMatch(/Invalid cascade tier/);
    expect(validateCascadeRegistryValue([{ model: 'openai/gpt-oss-120b', name: 'x', unknown: 1 }])).toMatch(/Invalid cascade tier/);
  });

  it('rejects non-arrays and empty arrays', () => {
    expect(validateCascadeRegistryValue({})).toMatch(/Expected an array/);
    expect(validateCascadeRegistryValue([])).toMatch(/at least one tier/);
    expect(validateCascadeRegistryValue(null)).toMatch(/Expected an array/);
  });

  it('exports the marker the save path and migration agree on', () => {
    expect(CASCADE_REGISTRY_VALIDATION_MARKER).toEqual({ kind: 'cascadeRegistry' });
  });
});
