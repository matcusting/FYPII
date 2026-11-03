import { prisma } from '../core/db.js'
import { applyEvidenceRetention, planEvidenceRetention, validateRetentionPolicy } from './evidence-retention.js'

type Kind = 'student' | 'identity' | 'property'
const flags = new Map<string, string>()
for (const arg of process.argv.slice(2)) {
  const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg)
  if (!match || flags.has(match[1]) || !['student-offer-end', 'identity-years', 'property-years', 'limit', 'apply', 'actor-email', 'confirm-maintenance', 'confirm'].includes(match[1])) {
    throw new Error('Unknown or repeated evidence-retention option. See RETENTION_OPERATIONS.md.')
  }
  flags.set(match[1], match[2] ?? '')
}

const policy: Partial<Record<Kind, number>> = {}
if (flags.has('student-offer-end')) {
  if (flags.get('student-offer-end')) throw new Error('--student-offer-end takes no value.')
  policy.student = 1
}
for (const [kind, flag] of [['identity', 'identity-years'], ['property', 'property-years']] as const) {
  const raw = flags.get(flag)
  if (raw !== undefined) policy[kind] = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
}
validateRetentionPolicy(policy)
const limitRaw = flags.get('limit')
const limit = limitRaw === undefined ? 100 : /^\d+$/.test(limitRaw) ? Number(limitRaw) : Number.NaN
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Use --limit=1..1000.')
const apply = flags.has('apply')
if (flags.get('apply') || flags.get('confirm-maintenance')) throw new Error('--apply and --confirm-maintenance take no value.')
if (apply && (flags.get('confirm') !== 'DELETE_ELIGIBLE_EVIDENCE' || !flags.has('confirm-maintenance') || !flags.get('actor-email'))) {
  throw new Error('Applying retention requires --actor-email, --confirm-maintenance, and --confirm=DELETE_ELIGIBLE_EVIDENCE.')
}
if (!apply && (flags.has('actor-email') || flags.has('confirm-maintenance') || flags.has('confirm'))) {
  throw new Error('Apply-only options are not accepted during a dry-run.')
}

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  if (!apply) {
    const plan = await planEvidenceRetention(policy, { limit })
    for (const kind of ['student', 'identity', 'property'] as const) {
      console.log(`${kind}: ${plan.byKind[kind].total} eligible case(s), ${plan.byKind[kind].rows.length} in this batch`)
    }
    console.log('Dry-run only. No database rows or files were changed.')
  } else {
    const email = flags.get('actor-email')!.trim().toLowerCase()
    const actor = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (!actor) throw new Error('The administrator actor was not found.')
    const result = await applyEvidenceRetention(policy, actor.id, { limit })
    for (const kind of ['student', 'identity', 'property'] as const) console.log(`${kind}: ${result.counts[kind]} case(s) purged`)
    console.log(`Completed ${result.processed} case(s). Rerun the dry-run to see whether more remain.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Evidence retention failed.')
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
