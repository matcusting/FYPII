import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prisma } from '../core/db.js'
import { processPendingFileDeletions } from './file-deletion.js'

async function main() {
  const limit = process.argv[2] === undefined ? 100 : Number(process.argv[2])
  const result = await processPendingFileDeletions({ limit })
  console.log(JSON.stringify(result))
  if (result.failed) process.exitCode = 1
  await prisma.$disconnect()
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(async error => {
    console.error('Private file cleanup failed:', error instanceof Error ? error.message : 'unknown')
    process.exitCode = 1
    await prisma.$disconnect()
  })
}
