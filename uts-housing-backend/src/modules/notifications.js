import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, parse, uuid } from '../utils/http.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const rows = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  ok(res, rows.map(({ userId, ...n }) => n));
});

router.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
  ok(res, { read: true });
});

router.post('/:id/read', async (req, res) => {
  const id = parse(uuid, req.params.id);
  await prisma.notification.updateMany({ where: { id, userId: req.user.id }, data: { readAt: new Date() } });
  ok(res, { read: true });
});

export default router;
