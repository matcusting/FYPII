type Approval = { status: string; expiresAt: Date | null } | null | undefined

export function approvalIsCurrent(record: Approval, now = new Date()): boolean {
  return record?.status === 'APPROVED' && record.expiresAt instanceof Date && record.expiresAt.getTime() > now.getTime()
}

export function effectiveApprovalStatus(record: Approval, now = new Date()): string {
  if (!record) return 'UNVERIFIED'
  return record.status === 'APPROVED' && !approvalIsCurrent(record, now) ? 'EXPIRED' : record.status
}

export function approvalValidityDays(kind: 'identity' | 'property'): number {
  const key = kind === 'identity' ? 'LANDLORD_IDENTITY_VALID_DAYS' : 'PROPERTY_AUTHORIZATION_VALID_DAYS'
  const fallback = kind === 'identity' ? 365 : 180
  const parsed = Number(process.env[key])
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1095 ? parsed : fallback
}

export function approvalExpiresAt(kind: 'identity' | 'property', now = new Date(), validUntil?: string): Date | null {
  const latest = new Date(now.getTime() + approvalValidityDays(kind) * 86_400_000)
  if (!validUntil) return latest
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return null
  // Reviews operate in Malaysia; the selected date expires at 23:59 MYT.
  const chosen = new Date(`${validUntil}T15:59:59.999Z`)
  if (Number.isNaN(chosen.getTime()) || new Date(`${validUntil}T00:00:00.000Z`).toISOString().slice(0, 10) !== validUntil) return null
  return chosen > now && chosen <= latest ? chosen : null
}
import type { Prisma } from '@prisma/client'
import { currentMalaysiaDate } from './student-verification.js'


export function listingApprovalWhere(now = new Date()): Prisma.ListingWhereInput {
  return {
    propertyAuthorizations: { some: { status: 'APPROVED', expiresAt: { gt: now } } },
    owner: {
      status: 'ACTIVE', emailVerifiedAt: { not: null },
      OR: [
        { roles: { has: 'LANDLORD' }, landlordVerifications: { some: { status: 'APPROVED', expiresAt: { gt: now } } } },
        { roles: { has: 'STUDENT' }, NOT: { roles: { has: 'LANDLORD' } }, studentVerified: true, studentVerifiedUntil: { gte: currentMalaysiaDate(now) } },
      ],
    },
  }
}

export function publicListingWhere(now = new Date()): Prisma.ListingWhereInput {
  return { status: 'PUBLISHED', ...listingApprovalWhere(now) }
}
