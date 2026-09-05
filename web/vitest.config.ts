import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // @vitejs/plugin-react overrides the tsconfig's "jsx": "preserve"
  // (required by Next.js for its own bundler) so oxc/rolldown can parse
  // JSX in .tsx test files and their component imports.
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '../../worker/src/chat-stream': path.resolve(__dirname, '../worker/src/chat-stream.ts'),
      '../../worker/src/services/ValidationService': path.resolve(__dirname, '../worker/src/services/ValidationService.ts'),
    },
    mainFields: ['module', 'main'],
    conditions: ['import', 'default', 'typescript'],
  },
  test: {
    globals: true,
    environment: 'node',
    // Post-review finding (2026-08-06): vitest.dom-setup.ts (jest-dom
    // matchers) existed but was never registered here -- dead code, no test
    // actually had access to toBeInTheDocument() etc.
    setupFiles: ['./vitest.dom-setup.ts'],
    // 2026-08-06 contract audit: was scoped only to lib/__tests__/** and the
    // worker's own __tests__/**, so colocated sibling test files (the exact
    // pattern contract-auditor's UNVERIFIED_ENDPOINT_NO_TEST rule expects
    // and rewards, e.g. web/lib/embeddings.test.ts next to embeddings.ts)
    // were silently never executed by vitest -- passing contract-auditor's
    // filesystem sibling check while giving zero real test-runner coverage.
    // Broadened (2026-08-06 rework) to a scoped `lib/**/*.test.ts` glob so
    // FUTURE sibling test files under lib/ are discovered automatically
    // instead of needing another manual include-list edit -- explicitly
    // excluding the 3 confirmed-still-broken pre-existing files below
    // (unrelated debt, out of scope for this pass) rather than reverting to
    // a narrow allowlist that would just recreate the original gap.
    include: [
      // .tsx included: lib/__tests__/TimestampLink.test.tsx (19 real RTL
      // render() tests) silently never ran under the .ts-only glob -- found
      // 2026-08-08 retro review of PR #212's vitest.config.ts. It wasn't in
      // the 86-file run at all (verified via `vitest run --reporter=verbose`
      // before this fix), despite passing contract-auditor's sibling-test
      // filesystem check and never failing CI, because CI never executed it.
      'lib/**/*.test.{ts,tsx}',
      'hooks/**/*.test.{ts,tsx}',
      'components/**/*.test.{ts,tsx}',
      'store/**/*.test.{ts,tsx}',
      'app/api/admin/logs/**/*.test.ts',
      'app/api/test-auth/**/*.test.ts',
      // Real coverage gap found 2026-08-20 (automated PR review P1): a
      // top-level web/middleware.test.ts matched none of the globs above --
      // same class of silent-non-execution as the .tsx gap documented
      // above (ADR 024). Named explicitly, not a broad '*.test.ts' -- a
      // wide top-level glob would silently pick up any future helper/
      // fixture file matching the pattern (real finding, CodeRabbit).
      'middleware.test.ts',
      '../worker/src/__tests__/**/*.test.ts',
      '../worker/src/*.test.ts',
      '../worker/src/services/LLMCascade.test.ts',
      '../worker/src/services/CommentClassifier.test.ts',
      // Real coverage gap found 2026-09-05 (PR #287 review): qa-intel's own
      // rule tests under scripts/quality-engine/**/*.test.ts (including the
      // pre-existing wave9-new-rules.test.ts) matched none of the globs
      // above -- same silent-non-execution class as the .tsx/middleware
      // gaps documented earlier in this file. Named explicitly rather than
      // a bare 'scripts/**' to avoid picking up unrelated future scripts.
      '../scripts/quality-engine/**/*.test.ts',
    ],
    exclude: [
      ...configDefaults.exclude,
      'tests/**',
      // Confirmed still-broken pre-existing tests (predate this pass,
      // verified broken again 2026-08-06 before excluding) -- fixing them
      // is unrelated debt, tracked separately, not silently re-included by
      // the broadened `lib/**/*.test.ts` glob above.
      'lib/services/__tests__/error-handler.test.ts',
      'lib/services/KnowledgeHistoryService.test.ts',
      'lib/skills/wiki-builder/wiki-builder.test.ts',
    ],
  },
});