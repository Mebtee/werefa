/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Wall-clock budget per test, not a CPU-work budget. This suite drives real
    // user journeys (typed input, multi-step routers, full provider trees) and
    // vitest fans out roughly one jsdom worker per core, so on a 16-core machine
    // a test doing ~350ms of work can be starved past the 5s default purely by
    // contention — which surfaced as an intermittent
    // "Test timed out in 5000ms" in the public booking flow and failed the
    // acceptance gate at random. 15s leaves ample headroom while still bounding
    // a genuine hang.
    testTimeout: 15000,
  },
})