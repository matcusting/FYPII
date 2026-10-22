import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = resolve(root, 'node_modules/prisma/build/index.js')
if (!existsSync(cli)) throw new Error('Install API dependencies before generating the Prisma client.')

// The current schema uses Prisma's JavaScript driver adapter (engineType=client).
// On Unix, Prisma CLI does not need a native engine to generate this client, but
// its downloader may be unavailable behind campus/cloud proxies.
const env = { ...process.env }
if (process.platform !== 'win32' && existsSync('/bin/true')) {
  env.PRISMA_SCHEMA_ENGINE_BINARY = env.PRISMA_SCHEMA_ENGINE_BINARY || '/bin/true'
  env.PRISMA_QUERY_ENGINE_LIBRARY = env.PRISMA_QUERY_ENGINE_LIBRARY || '/bin/true'
  env.PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING = '1'
}

const result = spawnSync(process.execPath, [cli, 'generate'], { cwd: root, env, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
