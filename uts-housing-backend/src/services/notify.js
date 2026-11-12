import { prisma } from '../db.js';

/** Create an in-app notification. Errors are swallowed so they never break the caller. */
export async function notify(userId, { type, title, body, link }) {
  try {
    await prisma.notification.create({ data: { userId, type, title, body, link } });
  } catch (err) {
    console.error('[notify] failed', err.message);
  }
}

export async function notifyAdmins(payload) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } });
  await Promise.all(admins.map((a) => notify(a.id, payload)));
}
