import { prisma } from '../db.js';
import { config } from '../config.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { forbidden, unauthorized } from '../utils/http.js';
import { disconnectSession } from '../realtime.js';

export const SESSION_COOKIE = 'uts_sid';

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'lax',
  path: '/',
  maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
});

/** Create a new session (a fresh ID on every login) and set the cookie. */
export async function startSession(res, userId) {
  const token = randomToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + config.sessionTtlDays * 86400000),
    },
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export async function endSession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, select: { id: true } });
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (session) disconnectSession(session.id);
  }
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
}

/** Attach req.user when a valid, unexpired, unrevoked session cookie is present. */
export async function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return next();
  if (session.user.status === 'SUSPENDED') return next();
  req.user = session.user;
  req.sessionId = session.id;
  // Sliding inactivity window: touch at most once per 10 minutes
  if (Date.now() - session.lastSeenAt.getTime() > 10 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  next();
}

export const requireAuth = (req, _res, next) => (req.user ? next() : next(unauthorized()));

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const requireEmailVerified = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!req.user.emailVerifiedAt) return next(forbidden('Please verify your e-mail address first.'));
  next();
};

export const requireVerifiedStudent = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'STUDENT') return next(forbidden('Only students can use this feature.'));
  if (!req.user.studentVerifiedAt)
    return next(forbidden('Your UTS student status has not been verified yet.'));
  next();
};
