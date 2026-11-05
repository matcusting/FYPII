import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import argon2 from 'argon2'
import { z } from 'zod'
import { prisma } from '../src/core/db.js'
import { tokenHash } from '../src/core/auth.js'
import { validateMfaConfiguration } from '../src/core/mfa.js'
import { configuredPublicUrl } from './invite-account.js'

const email = z.email().max(254).transform(value => value.toLowerCase())
const reason = z.string().trim().min(10).max(500).regex(/^[^\u0000-\u001f\u007f]+$/)

/** A server-shell-only emergency procedure. The current password is replaced
 * with an unknown random value and all sessions are revoked. The target must
 * prove control of its existing verified mailbox before MFA can be enrolled
 * again. No reset link or password is written to the terminal. */
export async function recoverPrivilegedMfa(input: { targetEmail: string; actorEmail: string; reason: string; soleAdmin: boolean }) {
  const base = configuredPublicUrl()
  validateMfaConfiguration()
  const targetAddress = email.parse(input.targetEmail)
  const actorAddress = email.parse(input.actorEmail)
  const note = reason.parse(input.reason)
  const rawToken = randomBytes(32).toString('hex')
  const unknownPasswordHash = await argon2.hash(randomBytes(48).toString('base64url'), { type: argon2.argon2id })
  const link = new URL('/reset-password', base)
  link.searchParams.set('token', rawToken)

  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(31415926)::text`
    const target = await tx.user.findUnique({ where: { email: targetAddress } })
    const actor = await tx.user.findUnique({ where: { email: actorAddress } })
    if (!target || !actor || target.status !== 'ACTIVE' || !target.emailVerifiedAt || !target.mfaSecretEncrypted
      || !target.roles.some(role => role === 'ADMIN' || role === 'LAWYER')
      || actor.status !== 'ACTIVE' || !actor.emailVerifiedAt || !actor.roles.includes('ADMIN')) {
      throw new Error('Both accounts must be active, email-verified privileged accounts; the authorizer must be an administrator.')
    }
    if (target.id === actor.id) {
      if (!input.soleAdmin || !target.roles.includes('ADMIN')) throw new Error('Self-recovery is allowed only for the sole administrator with an explicit acknowledgement.')
      const activeAdmins = await tx.user.count({ where: { status: 'ACTIVE', roles: { has: 'ADMIN' } } })
      if (activeAdmins !== 1) throw new Error('Another active administrator must authorize this recovery.')
    } else if (input.soleAdmin) throw new Error('Do not use sole-administrator recovery when a separate administrator authorizes the action.')
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${target.id} FOR UPDATE`
    const now = new Date()
    await tx.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now } })
    await tx.authToken.updateMany({ where: { userId: target.id, usedAt: null }, data: { usedAt: now } })
    await tx.emailJob.updateMany({ where: { to: target.email, template: { in: ['password-reset', 'account-invite'] }, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'FAILED', attempts: 5, payload: {} } })
    await tx.user.update({ where: { id: target.id }, data: {
      passwordHash: unknownPasswordHash, mfaSecretEncrypted: null, mfaPendingEncrypted: null,
      mfaPendingCreatedAt: null, mfaRecoveryHashes: [], mfaLastUsedStep: null,
      mfaFailedAttempts: 0, mfaLockedUntil: null,
    } })
    await tx.authToken.create({ data: { userId: target.id, kind: 'PASSWORD_RESET', tokenHash: tokenHash(rawToken), expiresAt: new Date(now.getTime() + 60 * 60_000) } })
    await tx.emailJob.create({ data: { to: target.email, subject: 'Reset your UTS Housing password', template: 'password-reset',
      payload: { name: target.name, url: link.toString() } } })
    await tx.auditLog.create({ data: { actorId: actor.id, action: 'PRIVILEGED_MFA_EMERGENCY_RESET', targetType: 'ACCOUNT', targetId: target.id,
      before: { mfaEnrolled: true }, after: { mfaEnrolled: false, allSessionsRevoked: true, passwordResetRequired: true, soleAdmin: input.soleAdmin, reason: note } } })
    return { role: target.roles.includes('ADMIN') ? 'ADMIN' : 'LAWYER', email: target.email }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = new Map<string, string>()
  for (const arg of process.argv.slice(2)) {
    const match = /^--(target-email|actor-email|reason|confirm|out-of-band-identity-confirmed|sole-admin-recovery)(?:=(.*))?$/.exec(arg)
    if (!match || options.has(match[1]) || (['out-of-band-identity-confirmed', 'sole-admin-recovery'].includes(match[1]) && match[2] !== undefined)) {
      throw new Error('Invalid emergency recovery option.')
    }
    options.set(match[1], match[2] || '')
  }
  const usage = 'Usage: npm run account:mfa-recover -- --target-email=... --actor-email=... --reason="Private reason" --out-of-band-identity-confirmed --confirm=RESET_PRIVILEGED_MFA [--sole-admin-recovery]'
  const work = options.get('confirm') !== 'RESET_PRIVILEGED_MFA' || !options.has('out-of-band-identity-confirmed')
    || !options.get('target-email') || !options.get('actor-email') || !options.get('reason')
    ? Promise.reject(new Error(usage)) : recoverPrivilegedMfa({ targetEmail: options.get('target-email')!, actorEmail: options.get('actor-email')!,
      reason: options.get('reason')!, soleAdmin: options.has('sole-admin-recovery') })
  work.then(result => process.stdout.write(`Emergency ${result.role} recovery queued for ${result.email}. Sessions are revoked; reset the password from the verified mailbox and enroll MFA again.\n`))
    .catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Emergency MFA recovery failed.'}\n`); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
}
