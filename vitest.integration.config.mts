import path from 'node:path'
import { config } from 'dotenv'
import { defineConfig } from 'vitest/config'

// Integration tests hit the real database in DATABASE_URL (temporary rows,
// cleaned up after). They are NOT part of `npm test`, so CI never runs them.
// Run on purpose with `npm run test:integration`.
config({ path: '.env.local' })

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname) },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
