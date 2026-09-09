import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    // Nest uses emitDecoratorMetadata for constructor DI tokens; vitest's
    // default esbuild transform drops it, so route .ts through SWC.
    swc.vite({
      module: { type: 'es6' },
      jsc: { target: 'es2022' },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    restoreMocks: true,
    // Integration test files each boot their own Nest application; run files
    // serially to avoid conflicting state across parallel DB resets.
    fileParallelism: false,
  },
});
