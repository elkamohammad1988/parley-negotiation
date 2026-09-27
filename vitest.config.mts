import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit and integration tests only. `evals/` is deliberately NOT picked up here:
// it drives real endpoints and spends real model generations, so it stays a
// manual pre-ship step (see evals/README.md for its pass criteria).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // Next resolves `server-only` to an empty module on the server; the npm
      // package throws everywhere else. Tests run on the server side of that line.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // A hung test is a broken test; the suite touches no network.
    testTimeout: 10_000,
  },
})
