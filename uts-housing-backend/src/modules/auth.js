import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { authLimiter } from '../middleware/security.js';
import { endSession, requireAuth, startSession } from '../middleware/auth.js';
import { hashPassword, isCommonPassword, randomToken, sha256, verifyPassword } from '../utils/crypto.js';
import { AppError, badRequest, conflict, ok, parse, unauthorized } from '../utils/http.js';
import { sendMail } from '../services/mailer.js';
import { notifyAdmins } from '../services/notify.js';
import { serializeMe } from '../services/serialize.js';

const router = Router();

const email = z.string().trim().toLowerCase().email('Enter a valid e-mail address.').max(254);
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128)
  .refine((p) => !isCommonPassword(p), 'This password is too common. Choose another one.');
const studentId = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,20}$/, 'Student ID should be 6–20 letters/digits, e.g. BCS24020031.');

const registerSchema = z
  .object({
    role: z.enum(['STUDENT', 'LANDLORD']),
    name: z.string().trim().min(2, 'Enter your full name.').max(100),
    email,
    password,
    acceptTerms: z.literal(true, { message: 'You must accept the terms of use.' }),
    studentId: studentId.optional(),
    major: z.string().trim().max(100).optional(),
    academicYear: z.string().trim().max(20).optional(),
    phone: z.string().trim().max(30).optional(),
    verificationNote: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.role !== 'STUDENT' || d.studentId, { path: ['studentId'], message: 'Student ID is required.' });

// Used to keep login timing similar whether or not the account exists.
const DUMMY_HASH = await hashPassword('timing-equaliser-not-a-real-password');

async function universityForEmail(addr) {
  const domain = addr.split('@')[1];
  const unis = await prisma.university.findMany();
  return unis.find((u) => u.emailDomains.map((d) => d.toLowerCase()).includes(domain)) || null;
}

async function sendVerificationEmail(user) {
  const token = randomToken();
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3600 * 1000) },
  });
  await sendMail({
    to: user.email,
    subject: 'Verify your UTS Housing & Roommate Finder account',
    text: `Hi ${user.name},\n\nPlease confirm your e-mail address by opening this link (valid for 24 hours):\n${config.frontendOrigin}/verify-email?token=${token}\n\nIf you did not create an account you can ignore this e-mail.`,
  });
}

router.post('/register', authLimiter, async (req, res) => {
  const data = parse(registerSchema, req.body);
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw conflict('An account with this e-mail already exists. Try logging in instead.');
  if (data.role === 'STUDENT') {
    const sid = await prisma.user.findUnique({ where: { studentId: data.studentId } });
    if (sid) throw conflict('This Student ID is already registered.');
  }

  const passwordHash = await hashPassword(data.password);
  const uni = data.role === 'STUDENT' ? await universityForEmail(data.email) : null;

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        role: data.role,
        name: data.name,
        email: data.email,
        passwordHash,
        studentId: data.role === 'STUDENT' ? data.studentId : null,
        major: data.role === 'STUDENT' ? data.major : null,
        academicYear: data.role === 'STUDENT' ? data.academicYear : null,
        phone: data.role === 'LANDLORD' ? data.phone : null,
      },
    });
    await tx.verification.create({
      data: {
        userId: u.id,
        type: data.role === 'STUDENT' ? 'STUDENT' : 'LANDLORD',
        // University e-mail domains are approved automatically once the inbox is confirmed.
        method: uni ? 'EMAIL_DOMAIN' : 'MANUAL',
        note: data.verificationNote,
      },
    });
    if (data.role === 'STUDENT') await tx.lifestyleProfile.create({ data: { userId: u.id } });
    return u;
  });

  await sendVerificationEmail(user);
  if (!uni) {
    await notifyAdmins({
      type: 'VERIFICATION_PENDING',
      title: data.role === 'STUDENT' ? 'Student verification pending' : 'Landlord verification pending',
      body: `${user.name} (${user.email}) is waiting for manual verification.`,
      link: '/admin/verifications',
    });
  }
  await startSession(res, user.id);
  ok(res, { user: serializeMe(user) }, undefined, 201);
});

const loginSchema = z.object({
  role: z.enum(['STUDENT', 'LANDLORD', 'ADMIN']).optional(),
  email,
  password: z.string().min(1, 'Enter your password.').max(128),
  studentId: studentId.optional(),
});

router.post('/login', authLimiter, async (req, res) => {
  const data = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  const valid = await verifyPassword(user?.passwordHash || DUMMY_HASH, data.password);
  if (!user || !valid) throw unauthorized('Incorrect e-mail or password.');

  // Report Fig 4.1: students authenticate with Student ID + UTS e-mail; mismatch → error and retry.
  if (data.role === 'STUDENT') {
    if (user.role !== 'STUDENT') throw unauthorized('This account is not a student account. Please use the correct tab.');
    if (!data.studentId || data.studentId !== user.studentId)
      throw unauthorized('Student verification failed: the Student ID does not match this UTS e-mail. Please try again.');
  } else if (data.role === 'LANDLORD' && user.role !== 'LANDLORD') {
    throw unauthorized('This account is not a landlord account. Please use the correct tab.');
  } else if (data.role === 'ADMIN' && user.role !== 'ADMIN') {
    throw unauthorized('This account is not an administrator account.');
  }
  if (user.status === 'SUSPENDED') throw new AppError(403, 'SUSPENDED', 'This account has been suspended. Contact support.');

  await endSession(req, res); // rotate: drop any previous session
  if (user.status === 'DELETION_REQUESTED') {
    // Logging back in cancels a pending deletion request.
    await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    user.status = 'ACTIVE';
  }
  await startSession(res, user.id);
  ok(res, { user: serializeMe(user) });
});

router.post('/logout', async (req, res) => {
  await endSession(req, res);
  ok(res, { loggedOut: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const [unreadNotifications, conversations] = await Promise.all([
    prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
    prisma.conversationParticipant.findMany({
      where: { userId: req.user.id },
      select: { conversationId: true, lastReadAt: true },
    }),
  ]);
  let unreadMessages = 0;
  for (const c of conversations) {
    unreadMessages += await prisma.message.count({
      where: { conversationId: c.conversationId, createdAt: { gt: c.lastReadAt }, senderId: { not: req.user.id } },
    });
  }
  const verification = await prisma.verification.findFirst({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select: { status: true, method: true, decisionNote: true, createdAt: true },
  });
  ok(res, { user: serializeMe(req.user), verification, unreadNotifications, unreadMessages });
});

router.post('/verify-email', authLimiter, async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!record || record.usedAt || record.expiresAt < new Date())
    throw badRequest('This verification link is invalid or has expired. Request a new one from your dashboard.');

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: now } });
    await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: record.user.emailVerifiedAt || now } });
    const pending = await tx.verification.findFirst({
      where: { userId: record.userId, type: 'STUDENT', method: 'EMAIL_DOMAIN', status: 'PENDING' },
    });
    if (pending) {
      await tx.verification.update({ where: { id: pending.id }, data: { status: 'APPROVED', reviewedAt: now, decisionNote: 'University e-mail confirmed.' } });
      await tx.user.update({ where: { id: record.userId }, data: { studentVerifiedAt: now } });
    }
  });
  ok(res, { verified: true });
});

router.post('/resend-verification', authLimiter, requireAuth, async (req, res) => {
  if (req.user.emailVerifiedAt) throw badRequest('Your e-mail is already verified.');
  await sendVerificationEmail(req.user);
  ok(res, { sent: true });
});

router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email: addr } = parse(z.object({ email }), req.body);
  const user = await prisma.user.findUnique({ where: { email: addr } });
  if (user && user.status !== 'SUSPENDED') {
    const token = randomToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600 * 1000) },
    });
    await sendMail({
      to: user.email,
      subject: 'Reset your UTS Housing password',
      text: `Hi ${user.name},\n\nUse this link within 1 hour to choose a new password:\n${config.frontendOrigin}/reset-password?token=${token}\n\nIf you did not ask for this, ignore this e-mail — your password stays the same.`,
    });
  }
  // Same response whether or not the account exists (no user enumeration).
  ok(res, { sent: true });
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const data = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(data.token) } });
  if (!record || record.usedAt || record.expiresAt < new Date())
    throw badRequest('This reset link is invalid or has expired. Please request a new one.');
  const passwordHash = await hashPassword(data.password);
  const now = new Date();
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    // Invalidate every existing session after a password reset.
    prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  ok(res, { reset: true });
});

router.post('/change-password', authLimiter, requireAuth, async (req, res) => {
  const data = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }), req.body);
  if (!(await verifyPassword(req.user.passwordHash, data.currentPassword))) throw badRequest('Your current password is incorrect.');
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await hashPassword(data.newPassword) } }),
    prisma.session.updateMany({
      where: { userId: req.user.id, revokedAt: null, id: { not: req.sessionId } },
      data: { revokedAt: new Date() },
    }),
  ]);
  ok(res, { changed: true });
});

router.post('/logout-all', requireAuth, async (req, res) => {
  await prisma.session.updateMany({ where: { userId: req.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await endSession(req, res);
  ok(res, { loggedOut: true });
});

router.post('/delete-account', authLimiter, requireAuth, async (req, res) => {
  const { password: pw } = parse(z.object({ password: z.string().min(1).max(128) }), req.body);
  if (!(await verifyPassword(req.user.passwordHash, pw))) throw badRequest('Your password is incorrect.');
  if (req.user.role === 'ADMIN') throw badRequest('Administrator accounts must be removed by another administrator.');
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user.id }, data: { status: 'DELETION_REQUESTED' } }),
    prisma.lifestyleProfile.updateMany({ where: { userId: req.user.id }, data: { discoverable: false } }),
    prisma.listing.updateMany({ where: { ownerId: req.user.id, status: 'PUBLISHED' }, data: { status: 'PAUSED' } }),
    prisma.session.updateMany({ where: { userId: req.user.id, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  await notifyAdmins({
    type: 'DELETION_REQUEST',
    title: 'Account deletion requested',
    body: `${req.user.name} (${req.user.email}) asked for their account to be deleted.`,
    link: '/admin/users',
  });
  await endSession(req, res);
  ok(res, { requested: true });
});

export default router;
