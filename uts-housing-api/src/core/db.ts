import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalPrisma = globalThis as unknown as { housingPrisma?: PrismaClient }
export const prisma = globalPrisma.housingPrisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
if (process.env.NODE_ENV !== 'production') globalPrisma.housingPrisma = prisma
