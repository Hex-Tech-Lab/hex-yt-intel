import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards against the exact drift that happened 2026-08-18: the code fallback
 * for digest.maxOutputTokens (used only if the Settings Registry is
 * unreachable) silently diverged from the live registry default (6000 vs
 * the real empirically-derived 3000). This test fails loudly if that
 * happens again, instead of relying on someone remembering to keep two
 * hardcoded numbers in sync by hand.
 */
describe('digest.maxOutputTokens fallback stays in sync with the registry default', () => {
  it('DIGEST_MAX_TOKENS_FALLBACK matches the real migration default_value', () => {
    const useCaseSource = readFileSync(
      join(__dirname, '../usecases/GenerateExecutiveDigestUseCase.ts'),
      'utf8'
    );
    const fallbackMatch = useCaseSource.match(/DIGEST_MAX_TOKENS_FALLBACK\s*=\s*(\d+)/);
    expect(fallbackMatch, 'DIGEST_MAX_TOKENS_FALLBACK constant not found').not.toBeNull();
    const fallbackValue = Number(fallbackMatch![1]);

    const migrationSource = readFileSync(
      join(
        __dirname,
        '../../../supabase/migrations/20260818070107_digest_max_output_tokens_empirical.sql'
      ),
      'utf8'
    );
    const registryMatch = migrationSource.match(/default_value\s*=\s*'(\d+)'::jsonb/);
    expect(registryMatch, 'default_value not found in the empirical-cap migration').not.toBeNull();
    const registryValue = Number(registryMatch![1]);

    expect(
      fallbackValue,
      `Code fallback (${fallbackValue}) has drifted from the real Settings Registry default (${registryValue}). Update DIGEST_MAX_TOKENS_FALLBACK to match, or update this test if the registry default was intentionally changed.`
    ).toBe(registryValue);
  });
});
