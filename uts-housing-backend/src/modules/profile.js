import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { badRequest, ok, parse } from '../utils/http.js';
import { notifyAdmins } from '../services/notify.js';
import { serializeMe } from '../services/serialize.js';

const router = Router();
router.use(requireAuth);

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  major: z.string().trim().max(100).nullable().optional(),
  academicYear: z.string().trim().max(20).nullable().optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  emailNotifications: z.boolean().optional(),
});

router.get('/', (req, res) => ok(res, { user: serializeMe(req.user) }));

router.patch('/', async (req, res) => {
  const data = parse(profileSchema, req.body);
  if (req.user.role !== 'STUDENT') { delete data.major; delete data.academicYear; }
  if (req.user.role !== 'LANDLORD') delete data.phone;
  const user = await prisma.user.update({ where: { id: req.user.id }, data });
  ok(res, { user: serializeMe(user) });
});

// Student / landlord verification (re)submission
router.get('/verification', async (req, res) => {
  const items = await prisma.verification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, method: true, status: true, note: true, decisionNote: true, createdAt: true, reviewedAt: true },
  });
  ok(res, items);
});

router.post('/verification', async (req, res) => {
  if (req.user.role === 'ADMIN') throw badRequest('Administrators do not need verification.');
  const { note } = parse(z.object({ note: z.string().trim().min(10, 'Tell the admin how to confirm your identity (at least 10 characters).').max(1000) }), req.body);
  const already = req.user.role === 'STUDENT' ? req.user.studentVerifiedAt : req.user.landlordVerifiedAt;
  if (already) throw badRequest('Your account is already verified.');
  const pending = await prisma.verification.findFirst({ where: { userId: req.user.id, status: 'PENDING', method: 'MANUAL' } });
  if (pending) throw badRequest('You already have a verification request waiting for review.');
  const v = await prisma.verification.create({
    data: { userId: req.user.id, type: req.user.role === 'STUDENT' ? 'STUDENT' : 'LANDLORD', method: 'MANUAL', note },
  });
  await notifyAdmins({ type: 'VERIFICATION_PENDING', title: 'Verification request', body: `${req.user.name} submitted a verification request.`, link: '/admin/verifications' });
  ok(res, v, undefined, 201);
});

export default router;
