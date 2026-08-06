import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '../../worker/src/chat-stream': path.resolve(__dirname, '../worker/src/chat-stream.ts'),
      '../../worker/src/services/ValidationService': path.resolve(__dirname, '../worker/src/services/ValidationService.ts'),
    },
    mainFields: ['module', 'main'],
    conditions: ['import', 'default', 'typescript'],
  },
  // Override the tsconfig's "jsx": "preserve" (Next.js requires it) for test
  // transforms -- Vite's import-analysis plugin checks tsconfig and throws
  // "if you use tsconfig.json, make sure to not set jsx to preserve" when a
  // .tsx file containing JSX is loaded. This Vite version's default
  // transform pipeline is Rolldown+oxc, not esbuild -- an `esbuild.jsx`
  // override is silently ignored ("oxc options will be used and esbuild
  // options will be ignored"/deprecation warning). Must set `oxc.jsx`
  // instead. Verified working: previously esbuild.jsx left WordCloud.tsx's
  // own JSX untransformed too (not just the test file's), causing a parse
  // error on import, not just on render(<Component />) calls.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'lib/__tests__/**/*.test.ts',
      'hooks/**/*.test.{ts,tsx}',
      'components/**/*.test.{ts,tsx}',
      'store/**/*.test.{ts,tsx}',
      '../worker/src/__tests__/**/*.test.ts',
    ],
    exclude: [...configDefaults.exclude, 'tests/**'],
  },
});