import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required to apply database migrations.')

const pool = new Pool({ connectionString: databaseUrl, max: 1 })
const client = await pool.connect()

try {
  await client.query('BEGIN')
  await client.query('SELECT pg_advisory_xact_lock(781424104)')
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id VARCHAR(36) PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL,
      logs TEXT,
      rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    )
  `)

  const names = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()

  for (const name of names) {
    const sql = await readFile(join(migrationsDirectory, name, 'migration.sql'), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const previous = await client.query<{ checksum: string; finished_at: Date | null }>(
      'SELECT checksum, finished_at FROM "_prisma_migrations" WHERE migration_name = $1 AND rolled_back_at IS NULL',
      [name],
    )
    if (previous.rowCount) {
      if (previous.rows[0]?.checksum !== checksum || !previous.rows[0]?.finished_at) {
        throw new Error(`Migration ${name} has changed or did not finish. Review database history before continuing.`)
      }
      process.stdout.write(`Already applied: ${name}\n`)
      continue
    }
    await client.query(sql)
    await client.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, $1, $2, now(), 1)`,
      [checksum, name],
    )
    process.stdout.write(`Applied: ${name}\n`)
  }
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
