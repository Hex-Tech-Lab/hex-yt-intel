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