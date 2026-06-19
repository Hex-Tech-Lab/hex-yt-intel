import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
    // Force .ts resolution over "main": "dist/worker.js" in worker/package.json
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
