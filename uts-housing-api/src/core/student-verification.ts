type StudentStatus = {
  studentVerified: boolean
  studentVerifiedUntil?: Date | null
}

/** Offer letters state a calendar date in Malaysia. The approval is valid
 * through that date and expires at the start of the following local day. */
export function currentMalaysiaDate(now = new Date()): Date {
  return new Date(new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) + 'T00:00:00.000Z')
}

export function studentVerificationIsCurrent(user: StudentStatus | null | undefined, now = new Date()): boolean {
  return Boolean(user?.studentVerified && user.studentVerifiedUntil && user.studentVerifiedUntil >= currentMalaysiaDate(now))
}

export function effectiveStudentVerificationStatus(user: StudentStatus & { verificationStatus: string }, now = new Date()): string {
  return user.verificationStatus === 'APPROVED' && !studentVerificationIsCurrent(user, now) ? 'EXPIRED' : user.verificationStatus
}
