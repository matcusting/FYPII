import { prisma } from '../core/db.js'
import { listingApprovalWhere } from '../core/approval.js'

// The public API checks validity on every read. This sweep keeps owner/admin
// status in sync and alerts owners if an approval expires between visits.
export async function pauseListingsWithoutCurrentApproval(now = new Date()): Promise<number> {
  const candidates = await prisma.listing.findMany({
    where: { status: { in: ['PUBLISHED', 'PENDING_REVIEW'] }, NOT: listingApprovalWhere(now) },
    select: { id: true, ownerId: true }, take: 100, orderBy: { updatedAt: 'asc' },
  })
  let paused = 0
  for (const candidate of candidates) {
    const changed = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.ownerId}))::text`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.id}))::text`
      const listing = await tx.listing.findUnique({ where: { id: candidate.id }, select: { status: true, ownerId: true, title: true, owner: { select: { email: true } } } })
      if (!listing || !['PUBLISHED', 'PENDING_REVIEW'].includes(listing.status)) return false
      if (await tx.listing.count({ where: { id: candidate.id, ...listingApprovalWhere(new Date()) } })) return false
      const result = await tx.listing.updateMany({
        where: { id: candidate.id, status: listing.status },
        data: { status: 'PAUSED', reviewedAt: null, moderationReason: 'An account or property authorization approval is no longer current.' },
      })
      if (!result.count) return false
      await tx.notification.create({ data: { userId: listing.ownerId, type: 'APPROVAL_EXPIRED', payload: { listingId: candidate.id } } })
      await tx.emailJob.create({ data: {
        to: listing.owner.email, subject: 'Property listing paused for verification', template: 'notification',
        payload: { body: `Your listing "${listing.title}" was paused because an account or property approval is no longer current. Review your verification status and submit fresh documents if needed.`, actionUrl: '/my-listings' },
      } })
      return true
    })
    if (changed) paused += 1
  }
  return paused
}
