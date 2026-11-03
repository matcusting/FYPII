import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import argon2 from 'argon2'
import { z } from 'zod'
import { prisma } from '../src/core/db.js'

const emailSchema = z.email().max(254).transform(value => value.trim().toLowerCase())

function localDatabaseOnly() {
  if (process.env.NODE_ENV === 'production' || !process.env.DATABASE_URL) throw new Error('This account provisioner is for a configured local development database only.')
  let hostname: string
  try { hostname = new URL(process.env.DATABASE_URL).hostname }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL.') }
  if (!['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(hostname)) throw new Error('Only a local PostgreSQL database is allowed.')
}

export async function provisionLocalLawyer(nameInput: string, emailInput: string) {
  localDatabaseOnly()
  const name = z.string().trim().min(2).max(100).parse(nameInput)
  const email = emailSchema.parse(emailInput)
  const password = randomBytes(32).toString('base64url')
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
  const user = await prisma.$transaction(async tx => {
    const existing = await tx.user.findUnique({ where: { email } })
    if (existing) throw new Error('This email already has an account. No role or password was changed.')
    return tx.user.create({ data: { name, email, passwordHash, roles: ['LAWYER'],
      profile: { create: { displayName: name } }, notificationPreference: { create: {} } } })
  })
  process.stdout.write(`Local lawyer account created: ${user.email}\nOne-time password: ${password}\nVerify the lawyer's identity independently and transfer this password privately. This command did not send an email or prove mailbox ownership.\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const name = args.find(value => value.startsWith('--name='))?.slice(7)
  const email = args.find(value => value.startsWith('--email='))?.slice(8)
  const unknown = args.some(value => !value.startsWith('--name=') && !value.startsWith('--email='))
  const work = unknown || !name || !email ? Promise.reject(new Error('Usage: npm run lawyer:provision -- --name="Review Lawyer" --email="lawyer@example.test"')) : provisionLocalLawyer(name, email)
  work.catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Provisioning failed.'}\n`); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
