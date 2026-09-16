import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// esbuild (vite's default TS transformer) cannot emit decorator metadata
// (`design:paramtypes`), which Nest's ValidationPipe relies on to infer DTO
// metatypes. SWC is used here so validation behaves identically in tests and
// in the tsc-based production build.
export default defineConfig({
  plugins: [swc.vite()],
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