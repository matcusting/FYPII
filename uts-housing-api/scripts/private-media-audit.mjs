import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { auditPrivateMedia, mediaDirectories, quarantineOrphans } from './private-media-core.mjs'

export async function readMediaRows(prisma) {
  const [uploads, studentVerifications, landlordVerifications, propertyAuthorizations, listingPhotos, reviews] = await Promise.all([
    prisma.mediaUpload.findMany({ select: { storageKey: true, purpose: true, status: true, size: true, mimeType: true } }),
    prisma.studentVerification.findMany({ select: { proofKey: true, studentIdKey: true, offerLetterKey: true } }),
    prisma.landlordVerification.findMany({ select: { identityKey: true, companyKey: true, representationKey: true } }),
    prisma.propertyAuthorization.findMany({ select: { proofKey: true, supportingKey: true } }),
    prisma.listingPhoto.findMany({ select: { storageKey: true } }),
    prisma.review.findMany({ where: { experienceProofKey: { not: null } }, select: { experienceProofKey: true } }),
  ])
  return { uploads, studentVerifications, landlordVerifications, propertyAuthorizations, listingPhotos, reviews }
}

async function keyIsUnreferenced(prisma, key) {
  const [upload, student, landlord, property, listing, review] = await Promise.all([
    prisma.mediaUpload.findUnique({ where: { storageKey: key }, select: { id: true } }),
    prisma.studentVerification.findFirst({ where: { OR: [{ proofKey: key }, { studentIdKey: key }, { offerLetterKey: key }] }, select: { id: true } }),
    prisma.landlordVerification.findFirst({ where: { OR: [{ identityKey: key }, { companyKey: key }, { representationKey: key }] }, select: { id: true } }),
    prisma.propertyAuthorization.findFirst({ where: { OR: [{ proofKey: key }, { supportingKey: key }] }, select: { id: true } }),
    prisma.listingPhoto.findUnique({ where: { storageKey: key }, select: { id: true } }),
    prisma.review.findFirst({ where: { experienceProofKey: key }, select: { id: true } }),
  ])
  return ![upload, student, landlord, property, listing, review].some(Boolean)
}

async function main() {
  const flags = process.argv.slice(2)
  const unexpected = flags.filter(flag => flag !== '--quarantine' && !/^--orphan-days=\d+$/.test(flag))
  if (unexpected.length) throw new Error(`Unknown option: ${unexpected[0]}. Use --orphan-days=30 and optionally --quarantine.`)
  const orphanDays = Number(flags.find(flag => flag.startsWith('--orphan-days='))?.split('=')[1] || '30')
  if (!Number.isSafeInteger(orphanDays) || orphanDays < 1) throw new Error('Choose --orphan-days as a positive whole number.')
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const { prisma } = await import('../src/core/db.ts')
  try {
    const directories = mediaDirectories()
    const report = await auditPrivateMedia(await readMediaRows(prisma), directories, { orphanDays })
    process.stdout.write(JSON.stringify({
      checkedUploads: report.checkedUploads,
      checkedReferences: report.checkedReferences,
      problems: report.problems,
      oldOrphanFiles: report.orphans.map(({ bucket, name }) => ({ bucket, name })),
    }, null, 2) + '\n')
    if (flags.includes('--quarantine')) {
      if (report.problems.length) throw new Error('Resolve missing or inconsistent live media before quarantining orphan files.')
      const result = await quarantineOrphans(report.orphans, directories, key => keyIsUnreferenced(prisma, key))
      process.stdout.write(`Moved ${result.moved} orphan files to private quarantine${result.directory ? `: ${result.directory}` : '.'}\n`)
    }
    if (report.problems.length) process.exitCode = 1
  } finally { await prisma.$disconnect() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Private media audit failed.')
    process.exitCode = 1
  })
}
