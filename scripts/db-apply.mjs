// Applies one SQL migration file to the database in DATABASE_URL, inside a
// transaction (all or nothing). See supabase/migrations/README.md.
//
//   npm run db:apply -- supabase/migrations/<file>.sql
import fs from 'node:fs'
import postgres from 'postgres'

const file = process.argv[2]
if (!file || !file.endsWith('.sql') || !fs.existsSync(file)) {
  console.error('Usage: npm run db:apply -- supabase/migrations/<file>.sql')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (expected in .env.local)')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
try {
  await sql.begin((tx) => tx.unsafe(fs.readFileSync(file, 'utf8')))
  console.log(`Applied ${file}`)
} catch (err) {
  console.error(`Failed (nothing was changed): ${err.message}`)
  process.exitCode = 1
} finally {
  await sql.end()
}
