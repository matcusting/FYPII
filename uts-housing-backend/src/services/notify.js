import { prisma } from '../db.js';
import { config } from '../config.js';
import { emitToUser } from '../realtime.js';
import { sendMail } from './mailer.js';

/**
 * Notification types that are also e-mailed (FR-09) — only to users who keep
 * "E-mail notifications" switched on. Chat messages stay in-app (they arrive in
 * real time) to avoid flooding inboxes. Security e-mails (verification links,
 * password reset) are sent directly by the auth module and cannot be turned off.
 */
export const EMAIL_TYPES = new Set([
  'LISTING_MODERATION',
  'LISTING_STALE',
  'LISTING_AUTO_PAUSED',
  'REVIEW_MODERATION',
  'INQUIRY',
  'CONNECTION_REQUEST',
  'CONNECTION_ACCEPTED',
]);

/**
 * Create an in-app notification, push it to the user's open tabs, and e-mail it
 * when the type allows and the user opted in. Errors are swallowed so they never
 * break the caller's main transaction.
 */
export async function notify(userId, { type, title, body, link }) {
  try {
    const n = await prisma.notification.create({ data: { userId, type, title, body, link } });
    emitToUser(userId, 'notification:new', { id: n.id, type, title, body, link, readAt: null, createdAt: n.createdAt });
    if (EMAIL_TYPES.has(type)) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, emailNotifications: true, status: true } });
      if (user && user.emailNotifications && user.status === 'ACTIVE') {
        const url = link ? `\n\nOpen: ${config.frontendOrigin}${link}` : '';
        await sendMail({
          to: user.email,
          subject: title,
          text: `Hi ${user.name},\n\n${body}${url}\n\n—\nYou can turn these e-mails off in your account settings.`,
        });
      }
    }
  } catch (err) {
    console.error('[notify] failed', err.message);
  }
}

export async function notifyAdmins(payload) {
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } });
  await Promise.all(admins.map((a) => notify(a.id, payload)));
}
