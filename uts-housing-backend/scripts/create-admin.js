// Securely provision an administrator (admins can never self-register).
// Usage: npm run create-admin -- "Full Name" admin@example.com
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { prisma } from '../src/db.js';
import { hashPassword, isCommonPassword } from '../src/utils/crypto.js';

const [name, emailArg] = process.argv.slice(2);
if (!name || !emailArg) {
  console.error('Usage: npm run create-admin -- "Full Name" admin@example.com');
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();
const rl = readline.createInterface({ input: stdin, output: stdout });
const password = process.env.ADMIN_PASSWORD || (await rl.question('Password (min 12 chars): '));
rl.close();
if (password.length < 12 || isCommonPassword(password)) {
  console.error('Password must be at least 12 characters and not a common password.');
  process.exit(1);
}
const now = new Date();
await prisma.user.upsert({
  where: { email },
  create: { name, email, role: 'ADMIN', passwordHash: await hashPassword(password), emailVerifiedAt: now },
  update: { role: 'ADMIN', passwordHash: await hashPassword(password), status: 'ACTIVE' },
});
console.log(`Administrator ${email} is ready.`);
await prisma.$disconnect();
