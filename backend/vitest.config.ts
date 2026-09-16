import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    cache: false,
    globals: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});