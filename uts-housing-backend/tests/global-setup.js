import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const url = process.env.TEST_DATABASE_URL || 'postgresql://uts:uts_dev_password@localhost:5432/uts_housing_test';

// Prepare the disposable test database: apply migrations, then empty every table.
export default async function setup() {
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to wipe "${dbName}": test database name must end with _test`);
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await prisma.$disconnect();
  return () => fs.rmSync('uploads-test', { recursive: true, force: true });
}
