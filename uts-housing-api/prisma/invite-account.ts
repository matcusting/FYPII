import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import argon2 from 'argon2'
import { z } from 'zod'
import { prisma } from '../src/core/db.js'
import { tokenHash } from '../src/core/auth.js'

type InviteRole = 'ADMIN' | 'LAWYER'
const invitationLifetimeMs = 24 * 60 * 60 * 1000
const emailSchema = z.email().max(254).transform(value => value.toLowerCase())
const nameSchema = z.string().trim().min(2).max(100)

export function configuredPublicUrl(): URL {
  if (process.env.NODE_ENV !== 'production') throw new Error('Production account invitations require NODE_ENV=production.')
  const fromAddress = /<([^>]+)>/.exec(process.env.EMAIL_FROM || '')?.[1] || process.env.EMAIL_FROM || ''
  if (!process.env.DATABASE_URL || !process.env.SMTP_HOST || !process.env.EMAIL_FROM || /@(?:example\.(?:local|com|test)|localhost)$/i.test(fromAddress)) {
    throw new Error('Configure the production database, SMTP_HOST and a real EMAIL_FROM before inviting privileged accounts.')
  }
  const secret = process.env.SESSION_SECRET || ''
  if (secret.length < 32 || secret.includes('replace-with') || secret.includes('development-only')) throw new Error('Configure a unique production SESSION_SECRET of at least 32 characters.')
  const url = new URL(process.env.PUBLIC_BASE_URL || '')
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Configure PUBLIC_BASE_URL as the HTTPS website origin.')
  return url
}

/** Queue a one-time, mailbox-bound invitation. No credential or token is
 * printed to stdout, and a new invitation never upgrades an existing account. */
export async function invitePrivilegedAccount(input: { role: InviteRole; name: string; email: string; actorEmail?: string; resend?: boolean }) {
  const base = configuredPublicUrl()
  const role = z.enum(['ADMIN', 'LAWYER']).parse(input.role)
  const name = nameSchema.parse(input.name)
  const address = emailSchema.parse(input.email)
  const actorEmail = input.actorEmail ? emailSchema.parse(input.actorEmail) : null
  if (role === 'LAWYER' && !actorEmail) throw new Error('A verified active administrator must authorize a lawyer invitation with --actor-email.')
  if (role === 'ADMIN' && actorEmail) throw new Error('The first administrator is bootstrapped without --actor-email.')
  const token = randomBytes(32).toString('hex')
  const link = new URL('/accept-invite', base)
  link.searchParams.set('token', token)
  // No one knows this password. The invited person must set their own via the
  // one-time link before the suspended account can be used.
  const unusablePasswordHash = input.resend ? null : await argon2.hash(randomBytes(48).toString('base64url'), { type: argon2.argon2id })

  const outcome = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(91208473)::text`
    const existing = await tx.user.findUnique({ where: { email: address }, include: { authTokens: { where: { kind: 'ACCOUNT_INVITE' }, take: 1 } } })
    if (role === 'ADMIN') {
      const adminCount = await tx.user.count({ where: { roles: { has: 'ADMIN' } } })
      if ((!input.resend && adminCount !== 0) || (input.resend && adminCount !== 1)) throw new Error('The first administrator already exists. Do not create another administrator with this bootstrap command.')
    }
    const actor = actorEmail ? await tx.user.findUnique({ where: { email: actorEmail } }) : null
    if (role === 'LAWYER' && (!actor || actor.status !== 'ACTIVE' || !actor.emailVerifiedAt || !actor.roles.includes('ADMIN'))) {
      throw new Error('The authorizing administrator must be active with a verified email.')
    }
    if (actor?.email === address) throw new Error('A reviewer invitation cannot target the authorizing administrator.')
    if (input.resend) {
      if (!existing || existing.status !== 'SUSPENDED' || existing.emailVerifiedAt || existing.name !== name
        || existing.roles.length !== 1 || existing.roles[0] !== role || existing.authTokens.length === 0) {
        throw new Error('Only an unaccepted invitation for this exact account may be resent.')
      }
    } else if (existing) {
      throw new Error('This email already has an account. Existing roles and passwords were not changed.')
    }
    const user = existing || await tx.user.create({ data: {
      name, email: address, passwordHash: unusablePasswordHash!, roles: [role], status: 'SUSPENDED',
      profile: { create: { displayName: name } }, notificationPreference: { create: {} },
    } })
    await tx.authToken.updateMany({ where: { userId: user.id, kind: 'ACCOUNT_INVITE', usedAt: null }, data: { usedAt: new Date() } })
    await tx.emailJob.updateMany({ where: { to: address, template: 'account-invite', status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'FAILED', attempts: 5, payload: {} } })
    await tx.authToken.create({ data: { userId: user.id, kind: 'ACCOUNT_INVITE', tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + invitationLifetimeMs) } })
    await tx.emailJob.create({ data: { to: address, subject: `Your UTS Housing ${role === 'ADMIN' ? 'administrator' : 'legal reviewer'} invitation`,
      template: 'account-invite', payload: { name, url: link.toString(), role } } })
    await tx.auditLog.create({ data: { actorId: actor?.id || user.id, action: input.resend ? 'PRIVILEGED_INVITE_RESENT' : 'PRIVILEGED_INVITE_CREATED',
      targetType: 'ACCOUNT', targetId: user.id, after: { role, invitationExpiresInHours: 24 } } })
    return { email: address, role, resent: Boolean(input.resend) }
  })
  return outcome
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = new Map<string, string>()
  let invalid = false
  for (const arg of process.argv.slice(2)) {
    const match = /^--(role|name|email|actor-email|resend)(?:=(.*))?$/.exec(arg)
    if (!match || options.has(match[1]) || (match[1] === 'resend' && match[2] !== undefined)) { invalid = true; break }
    options.set(match[1], match[2] || '')
  }
  const role = options.get('role')
  const name = options.get('name')
  const email = options.get('email')
  const actorEmail = options.get('actor-email')
  const usage = 'Usage: npm run account:invite -- --role=ADMIN|LAWYER --name="Name" --email="address" [--actor-email=verified-admin-address] [--resend]'
  const work = invalid || !role || !name || !email ? Promise.reject(new Error(usage))
    : invitePrivilegedAccount({ role: role as InviteRole, name, email, actorEmail, resend: options.has('resend') })
  work.then(result => { process.stdout.write(`${result.resent ? 'Replacement' : 'New'} ${result.role} invitation queued for ${result.email}. The one-time link is sent by the email worker; no password or token is printed.\n`) })
    .catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Account invitation failed.'}\n`); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
}
