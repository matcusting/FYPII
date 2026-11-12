import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRole, requireVerifiedStudent } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/security.js';
import { badRequest, forbidden, notFound, ok, parse, uuid } from '../utils/http.js';
import { DIMENSIONS, MAX_WEIGHT, budgetsOverlap, compatibility, moveInCompatible, normaliseWeights } from '../services/matching.js';
import { serializePublicUser } from '../services/serialize.js';
import { notify } from '../services/notify.js';
import { blockedIdsFor, findOrCreateConversation } from './conversations.js';

const router = Router();
router.use(requireRole('STUDENT'));

const habitFields = Object.fromEntries(
  DIMENSIONS.map((d) => [d.key, z.enum(d.options, { message: `Choose a valid ${d.label.toLowerCase()}.` }).nullable().optional()]),
);

const profileSchema = z
  .object({
    ...habitFields,
    weights: z.record(z.string(), z.coerce.number().int().min(1).max(MAX_WEIGHT)).optional(),
    smokeFreeOnly: z.boolean().optional(),
    budgetMin: z.coerce.number().int().min(0).max(100000).nullable().optional(),
    budgetMax: z.coerce.number().int().min(0).max(100000).nullable().optional(),
    moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    preferredArea: z.string().trim().max(120).nullable().optional(),
    discoverable: z.boolean().optional(),
  })
  .refine((d) => d.budgetMin == null || d.budgetMax == null || d.budgetMin <= d.budgetMax, {
    path: ['budgetMax'],
    message: 'Maximum budget must be at least the minimum budget.',
  });

const serializeProfile = (p) => ({
  ...Object.fromEntries(DIMENSIONS.map((d) => [d.key, p[d.key]])),
  weights: normaliseWeights(p.weights),
  smokeFreeOnly: p.smokeFreeOnly,
  budgetMin: p.budgetMin,
  budgetMax: p.budgetMax,
  moveInDate: p.moveInDate ? p.moveInDate.toISOString().slice(0, 10) : null,
  preferredArea: p.preferredArea,
  discoverable: p.discoverable,
  updatedAt: p.updatedAt,
});

async function myProfile(userId) {
  return prisma.lifestyleProfile.upsert({ where: { userId }, create: { userId }, update: {} });
}

router.get('/profile', async (req, res) => {
  ok(res, serializeProfile(await myProfile(req.user.id)));
});

router.put('/profile', async (req, res) => {
  const d = parse(profileSchema, req.body);
  const data = { ...d };
  if (d.weights) data.weights = normaliseWeights(d.weights);
  if (d.moveInDate !== undefined) data.moveInDate = d.moveInDate ? new Date(d.moveInDate) : null;
  const p = await prisma.lifestyleProfile.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, ...data }, update: data });
  ok(res, serializeProfile(p));
});

/* ----------------------------------------------------------------- matches */

router.get('/matches', requireVerifiedStudent, async (req, res) => {
  const me = await myProfile(req.user.id);
  const core = DIMENSIONS.filter((d) => d.core);
  const missing = core.filter((d) => !me[d.key]);
  if (missing.length) throw badRequest(`Complete your habit profile first: ${missing.map((d) => d.label).join(', ')}.`);
  if (!me.discoverable) throw forbidden('Turn on "Show my profile to other students" to see your matches.');

  const blocked = await blockedIdsFor(req.user.id);
  const candidates = await prisma.lifestyleProfile.findMany({
    where: {
      discoverable: true,
      userId: { notIn: [req.user.id, ...blocked] },
      user: { role: 'STUDENT', status: 'ACTIVE', studentVerifiedAt: { not: null } },
    },
    include: { user: true },
  });
  const requests = await prisma.connectionRequest.findMany({
    where: { OR: [{ senderId: req.user.id }, { recipientId: req.user.id }] },
  });
  const requestWith = new Map();
  for (const r of requests) {
    const other = r.senderId === req.user.id ? r.recipientId : r.senderId;
    requestWith.set(other, { id: r.id, status: r.status, direction: r.senderId === req.user.id ? 'sent' : 'received' });
  }

  let insufficient = 0;
  let excludedCount = 0;
  const results = [];
  for (const c of candidates) {
    if (!budgetsOverlap(me, c) || !moveInCompatible(me, c)) { excludedCount++; continue; }
    const result = compatibility(me, c);
    if (result.excluded) { excludedCount++; continue; }
    if (result.score == null) { insufficient++; continue; }
    results.push({
      user: serializePublicUser(c.user),
      bio: c.user.bio,
      score: result.score,
      breakdown: result.breakdown,
      budget: { min: c.budgetMin, max: c.budgetMax },
      moveInDate: c.moveInDate ? c.moveInDate.toISOString().slice(0, 10) : null,
      preferredArea: c.preferredArea,
      request: requestWith.get(c.userId) || null,
    });
  }
  results.sort((a, b) => b.score - a.score || a.user.name.localeCompare(b.user.name));
  ok(res, results, { excludedByPreferences: excludedCount, insufficientData: insufficient });
});

/* -------------------------------------------------------- connection requests */

const shapeRequest = (r, meId) => ({
  id: r.id,
  status: r.status,
  message: r.message,
  score: r.score,
  createdAt: r.createdAt,
  respondedAt: r.respondedAt,
  direction: r.senderId === meId ? 'sent' : 'received',
  user: serializePublicUser(r.senderId === meId ? r.recipient : r.sender),
});

router.get('/requests', async (req, res) => {
  const rows = await prisma.connectionRequest.findMany({
    where: { OR: [{ senderId: req.user.id }, { recipientId: req.user.id }] },
    include: { sender: true, recipient: true },
    orderBy: { createdAt: 'desc' },
  });
  ok(res, rows.map((r) => shapeRequest(r, req.user.id)));
});

router.post('/requests', requireVerifiedStudent, writeLimiter, async (req, res) => {
  const { recipientId, message } = parse(
    z.object({ recipientId: uuid, message: z.string().trim().max(500).optional() }),
    req.body,
  );
  if (recipientId === req.user.id) throw badRequest('You cannot connect with yourself.');
  const blocked = await blockedIdsFor(req.user.id);
  if (blocked.includes(recipientId)) throw notFound('Student not found.');
  const [me, them] = await Promise.all([
    myProfile(req.user.id),
    prisma.lifestyleProfile.findFirst({
      where: { userId: recipientId, discoverable: true, user: { role: 'STUDENT', status: 'ACTIVE', studentVerifiedAt: { not: null } } },
      include: { user: true },
    }),
  ]);
  if (!them) throw notFound('Student not found.');
  const result = compatibility(me, them);
  if (result.excluded) throw badRequest('You have a deal-breaker conflict with this student.');

  const reverse = await prisma.connectionRequest.findUnique({
    where: { senderId_recipientId: { senderId: recipientId, recipientId: req.user.id } },
  });
  if (reverse?.status === 'PENDING') {
    // They already asked — sending back counts as accepting.
    const accepted = await acceptRequest(reverse.id);
    return ok(res, shapeRequest(accepted, req.user.id));
  }
  const existing = await prisma.connectionRequest.findUnique({
    where: { senderId_recipientId: { senderId: req.user.id, recipientId } },
  });
  if (existing && existing.status !== 'DECLINED') throw badRequest('You already sent a request to this student.');
  const r = existing
    ? await prisma.connectionRequest.update({
        where: { id: existing.id },
        data: { status: 'PENDING', message, score: result.score, respondedAt: null, createdAt: new Date() },
        include: { sender: true, recipient: true },
      })
    : await prisma.connectionRequest.create({
        data: { senderId: req.user.id, recipientId, message, score: result.score },
        include: { sender: true, recipient: true },
      });
  await notify(recipientId, {
    type: 'CONNECTION_REQUEST',
    title: 'New roommate request',
    body: `${req.user.name} wants to connect with you${result.score != null ? ` (${result.score}% match)` : ''}.`,
    link: '/student/roommates',
  });
  ok(res, shapeRequest(r, req.user.id), undefined, 201);
});

async function acceptRequest(id) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.connectionRequest.update({
      where: { id },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
      include: { sender: true, recipient: true },
    });
    const convo = await findOrCreateConversation(tx, { type: 'ROOMMATE', userIds: [r.senderId, r.recipientId] });
    if (r.message) {
      const already = await tx.message.count({ where: { conversationId: convo.id } });
      if (!already) await tx.message.create({ data: { conversationId: convo.id, senderId: r.senderId, body: r.message } });
    }
    await tx.notification.create({
      data: {
        userId: r.senderId,
        type: 'CONNECTION_ACCEPTED',
        title: 'Roommate request accepted',
        body: `${r.recipient.name} accepted your request. You can now chat in Messages.`,
        link: '/student/messages',
      },
    });
    return r;
  });
}

router.patch('/requests/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { action } = parse(z.object({ action: z.enum(['accept', 'decline']) }), req.body);
  const r = await prisma.connectionRequest.findUnique({ where: { id } });
  if (!r || r.recipientId !== req.user.id) throw notFound('Request not found.');
  if (r.status !== 'PENDING') throw badRequest('This request has already been answered.');
  if (action === 'accept') {
    if (!req.user.studentVerifiedAt) throw forbidden('Your UTS student status has not been verified yet.');
    return ok(res, shapeRequest(await acceptRequest(id), req.user.id));
  }
  const declined = await prisma.connectionRequest.update({
    where: { id },
    data: { status: 'DECLINED', respondedAt: new Date() },
    include: { sender: true, recipient: true },
  });
  ok(res, shapeRequest(declined, req.user.id));
});

router.delete('/requests/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const r = await prisma.connectionRequest.findUnique({ where: { id } });
  if (!r || r.senderId !== req.user.id) throw notFound('Request not found.');
  if (r.status !== 'PENDING') throw badRequest('Only pending requests can be withdrawn.');
  await prisma.connectionRequest.delete({ where: { id } });
  ok(res, { withdrawn: true });
});

export default router;
