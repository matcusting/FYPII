import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/security.js';
import { badRequest, notFound, ok, parse, uuid } from '../utils/http.js';
import { notifyAdmins } from '../services/notify.js';
import { REPORT_REASONS } from './constants.js';

const router = Router();
router.use(requireAuth);

const schema = z.object({
  targetType: z.enum(['LISTING', 'USER', 'REVIEW', 'MESSAGE']),
  targetId: uuid,
  reason: z.enum(REPORT_REASONS, { message: 'Choose a reason.' }),
  details: z.string().trim().max(2000).optional(),
});

const exists = {
  LISTING: (id) => prisma.listing.findFirst({ where: { id, deletedAt: null } }),
  USER: (id) => prisma.user.findUnique({ where: { id } }),
  REVIEW: (id) => prisma.review.findUnique({ where: { id } }),
  MESSAGE: (id) => prisma.message.findUnique({ where: { id } }),
};

router.post('/', writeLimiter, async (req, res) => {
  const d = parse(schema, req.body);
  if (!(await exists[d.targetType](d.targetId))) throw notFound('The item you are reporting no longer exists.');
  if (d.targetType === 'USER' && d.targetId === req.user.id) throw badRequest('You cannot report yourself.');
  const dup = await prisma.report.findFirst({
    where: { reporterId: req.user.id, targetType: d.targetType, targetId: d.targetId, status: 'OPEN' },
  });
  if (dup) throw badRequest('You have already reported this. Our admins are looking into it.');
  const report = await prisma.report.create({ data: { ...d, reporterId: req.user.id } });
  await notifyAdmins({ type: 'REPORT', title: 'New abuse report', body: `${d.targetType.toLowerCase()}: ${d.reason}`, link: '/admin/reports' });
  ok(res, { id: report.id, status: report.status }, undefined, 201);
});

router.get('/mine', async (req, res) => {
  const rows = await prisma.report.findMany({
    where: { reporterId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, targetType: true, reason: true, status: true, resolution: true, createdAt: true },
  });
  ok(res, rows);
});

export default router;
