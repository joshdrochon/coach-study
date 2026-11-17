import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const CORE = { lines: 90, functions: 90, branches: 90, statements: 90 }

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),

      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',

    globalSetup: ['src/test/db-guard.ts'],

    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',

      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/lib/db/schema.ts'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: {
        lines: 70,
        functions: 65,
        branches: 60,
        statements: 70,

        'src/lib/gates/**': CORE,
        'src/lib/scheduler/**': CORE,
        'src/lib/grader/**': { ...CORE, branches: 80 },

        'src/lib/content/reviews.ts': CORE,
      },
    },
  },
})
