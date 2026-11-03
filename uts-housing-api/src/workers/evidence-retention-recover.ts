import { prisma } from '../core/db.js'
import { recoverEvidenceQuarantine } from './evidence-retention.js'

const args = process.argv.slice(2)
if (args.some(arg => !['--apply', '--confirm-maintenance'].includes(arg)) || new Set(args).size !== args.length) {
  throw new Error('Use no flags for a recovery dry-run, or --apply --confirm-maintenance to restore database-referenced files.')
}
const apply = args.includes('--apply')
if (apply !== args.includes('--confirm-maintenance')) throw new Error('Recovery apply requires both --apply and --confirm-maintenance.')

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const result = await recoverEvidenceQuarantine({ apply })
  console.log(`Quarantined files still referenced by the database: ${result.referenced}`)
  console.log(`Quarantined files without live evidence references: ${result.unreferenced}`)
  console.log(apply ? `Restored files: ${result.restored}` : 'Dry-run only. No files were changed.')
  if (result.unreferenced) console.log('Unreferenced quarantined files remain untouched. Review the private-media audit and backup policy before removing them.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Evidence quarantine recovery failed.')
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
