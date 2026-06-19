import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      // Force worker source .ts resolution over "main": "dist/worker.js"
      '../../worker/src/chat-stream': path.resolve(__dirname, '../worker/src/chat-stream.ts'),
      '../../worker/src/services/ValidationService': path.resolve(__dirname, '../worker/src/services/ValidationService.ts'),
    },
    mainFields: ['module', 'main'],
    conditions: ['import', 'default', 'typescript'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['lib/__tests__/**/*.test.ts', '../worker/src/__tests__/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/**'],
  },
});
