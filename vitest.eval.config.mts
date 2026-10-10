import path from 'node:path'
import { config } from 'dotenv'
import { defineConfig } from 'vitest/config'

// The match-quality eval (tests/eval) calls a real AI provider with the
// EVAL_* key in .env.local. It is NOT part of `npm test`, so CI never runs it.
// Run on purpose with `npm run eval:matching`.
config({ path: '.env.local' })

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname) },
  },
  test: {
    environment: 'node',
    include: ['tests/eval/**/*.eval.ts'],
    fileParallelism: false,
  },
})
