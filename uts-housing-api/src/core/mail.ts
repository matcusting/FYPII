import { prisma } from './db.js'
import type { Prisma } from '@prisma/client'

export async function queueEmail(to: string, subject: string, template: string, payload: Record<string, unknown>) {
  return prisma.emailJob.create({ data: { to, subject, template, payload: payload as Prisma.InputJsonValue } })
}
