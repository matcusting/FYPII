import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { messageLimiter, writeLimiter } from '../middleware/security.js';
import { badRequest, forbidden, notFound, ok, parse, uuid } from '../utils/http.js';
import { googleMapsUrl, photoUrl, serializePublicUser } from '../services/serialize.js';
import { notify } from '../services/notify.js';
import { emitToUser } from '../realtime.js';
import { GENDER_RESTRICTION_LABELS, genderAllowed } from './constants.js';

/* ----------------------------------------------------------------- helpers */

/** IDs of users that `userId` blocked or was blocked by. */
export async function blockedIdsFor(userId) {
  const rows = await prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
  return [...new Set(rows.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)))];
}

/** Find a conversation with exactly these participants (+ listing), or create it. */
export async function findOrCreateConversation(tx, { type, userIds, listingId = null }) {
  const existing = await tx.conversation.findFirst({
    where: {
      type,
      listingId,
      AND: userIds.map((id) => ({ participants: { some: { userId: id } } })),
    },
  });
  if (existing) return existing;
  return tx.conversation.create({
    data: { type, listingId, participants: { create: userIds.map((userId) => ({ userId })) } },
  });
}

const messageBody = z.object({ body: z.string().trim().min(1, 'Message cannot be empty.').max(2000) });

async function postMessage(conversationId, sender, body) {
  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.message.create({ data: { conversationId, senderId: sender.id, body } }),
    prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: now } }),
    prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: sender.id } },
      data: { lastReadAt: now },
    }),
  ]);
  return message;
}

const shapeMessage = (m, meId) => ({ id: m.id, body: m.body, createdAt: m.createdAt, mine: m.senderId === meId, senderName: m.sender?.name });

/** Push a new message to every participant's open tabs (each gets its own `mine` flag). */
async function broadcastMessage(conversationId, message, sender) {
  const parts = await prisma.conversationParticipant.findMany({ where: { conversationId }, select: { userId: true } });
  for (const p of parts) {
    emitToUser(p.userId, 'message:new', { conversationId, message: shapeMessage({ ...message, sender }, p.userId) });
  }
}

/* ------------------------------------------------------------ conversations */

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const parts = await prisma.conversationParticipant.findMany({
    where: { userId: req.user.id },
    include: {
      conversation: {
        include: {
          listing: { include: { photos: true, owner: true, amenities: { include: { amenity: true } } } },
          participants: { include: { user: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
    orderBy: { conversation: { updatedAt: 'desc' } },
  });
  const blocked = new Set(await blockedIdsFor(req.user.id));
  const out = [];
  for (const p of parts) {
    const c = p.conversation;
    const other = c.participants.find((x) => x.userId !== req.user.id)?.user;
    const unread = await prisma.message.count({
      where: { conversationId: c.id, createdAt: { gt: p.lastReadAt }, senderId: { not: req.user.id } },
    });
    out.push({
      id: c.id,
      type: c.type,
      updatedAt: c.updatedAt,
      unread,
      blocked: other ? blocked.has(other.id) : false,
      other: other ? serializePublicUser(other) : null,
      lastMessage: c.messages[0] ? shapeMessage(c.messages[0], req.user.id) : null,
      listing: c.listing
        ? {
            id: c.listing.id,
            title: c.listing.title,
            rent: Number(c.listing.rent),
            deposit: Number(c.listing.deposit),
            distanceKm: Number(c.listing.distanceKm),
            roomType: c.listing.roomType,
            description: c.listing.description,
            status: c.listing.status,
            facilities: c.listing.amenities.map((a) => a.amenity.name),
            photos: c.listing.photos.sort((a, b) => a.sortOrder - b.sortOrder).map((ph) => ({ id: ph.id, url: photoUrl(ph.objectKey) })),
            landlord: serializePublicUser(c.listing.owner),
            address: c.listing.address,
            googleMapsUrl: googleMapsUrl(c.listing),
          }
        : null,
    });
  }
  ok(res, out);
});

async function myConversation(req) {
  const id = parse(uuid, req.params.id);
  const part = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: req.user.id } },
    include: { conversation: { include: { participants: true } } },
  });
  if (!part) throw notFound('Conversation not found.');
  return part.conversation;
}

router.get('/:id/messages', async (req, res) => {
  const convo = await myConversation(req);
  const messages = await prisma.message.findMany({
    where: { conversationId: convo.id },
    include: { sender: true },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId: convo.id, userId: req.user.id } },
    data: { lastReadAt: new Date() },
  });
  ok(res, messages.map((m) => shapeMessage(m, req.user.id)));
});

router.post('/:id/messages', messageLimiter, async (req, res) => {
  const convo = await myConversation(req);
  const { body } = parse(messageBody, req.body);
  const others = convo.participants.filter((p) => p.userId !== req.user.id).map((p) => p.userId);
  const blocked = await blockedIdsFor(req.user.id);
  if (others.some((id) => blocked.includes(id))) throw forbidden('You cannot message this user.');
  const msg = await postMessage(convo.id, req.user, body);
  await broadcastMessage(convo.id, msg, req.user);
  for (const id of others) {
    await notify(id, { type: 'MESSAGE', title: 'New message', body: `${req.user.name}: ${body.slice(0, 80)}`, link: null });
  }
  ok(res, shapeMessage({ ...msg, sender: req.user }, req.user.id), undefined, 201);
});

// Find or start the conversation with administrators (support channel).
router.post('/support', async (req, res) => {
  if (req.user.role === 'ADMIN') throw badRequest('Administrators answer support conversations from the admin portal.');
  const existing = await prisma.conversation.findFirst({
    where: { type: 'SUPPORT', participants: { some: { userId: req.user.id } } },
  });
  if (existing) return ok(res, { id: existing.id });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw badRequest('Support is not available right now.');
  const convo = await prisma.$transaction(async (tx) => {
    const c = await findOrCreateConversation(tx, { type: 'SUPPORT', userIds: [req.user.id, admin.id] });
    await tx.message.create({
      data: {
        conversationId: c.id,
        senderId: admin.id,
        body: 'Welcome to UTS Housing & Roommate Finder! If you have any issues with your account, please reply here.',
      },
    });
    return c;
  });
  ok(res, { id: convo.id }, undefined, 201);
});

export default router;

/* ------------------------------------------- listing inquiries & blocking */

export const inquiryRouter = Router({ mergeParams: true });
inquiryRouter.post('/', requireAuth, writeLimiter, async (req, res) => {
  const listingId = parse(uuid, req.params.id);
  const { body } = parse(messageBody, req.body);
  const listing = await prisma.listing.findFirst({ where: { id: listingId, status: 'PUBLISHED', deletedAt: null } });
  if (!listing) throw notFound('Listing not found.');
  if (listing.ownerId === req.user.id) throw badRequest('This is your own listing.');
  if (req.user.role === 'STUDENT' && listing.genderRestriction !== 'ANY') {
    if (!req.user.gender) throw badRequest('Set your gender in My Profile first — this landlord only rents to one gender.');
    if (!genderAllowed(listing.genderRestriction, req.user.gender))
      throw forbidden(`This property is for ${GENDER_RESTRICTION_LABELS[listing.genderRestriction].toLowerCase()}.`);
  }
  const blocked = await blockedIdsFor(req.user.id);
  if (blocked.includes(listing.ownerId)) throw forbidden('You cannot contact this landlord.');
  const convo = await prisma.$transaction((tx) =>
    findOrCreateConversation(tx, { type: 'LISTING_INQUIRY', userIds: [req.user.id, listing.ownerId], listingId }),
  );
  const msg = await postMessage(convo.id, req.user, body);
  await broadcastMessage(convo.id, msg, req.user);
  await notify(listing.ownerId, {
    type: 'INQUIRY',
    title: 'New student inquiry',
    body: `${req.user.name} asked about "${listing.title}".`,
    link: '/landlord',
  });
  ok(res, { conversationId: convo.id }, undefined, 201);
});

export const blocksRouter = Router();
blocksRouter.use(requireAuth);
blocksRouter.get('/', async (req, res) => {
  const rows = await prisma.block.findMany({ where: { blockerId: req.user.id }, include: { blocked: true } });
  ok(res, rows.map((b) => serializePublicUser(b.blocked)));
});
blocksRouter.post('/:userId', async (req, res) => {
  const userId = parse(uuid, req.params.userId);
  if (userId === req.user.id) throw badRequest('You cannot block yourself.');
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role === 'ADMIN') throw notFound('User not found.');
  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: req.user.id, blockedId: userId } },
    create: { blockerId: req.user.id, blockedId: userId },
    update: {},
  });
  // Blocking also cancels pending roommate requests between the two.
  await prisma.connectionRequest.deleteMany({
    where: { status: 'PENDING', OR: [{ senderId: req.user.id, recipientId: userId }, { senderId: userId, recipientId: req.user.id }] },
  });
  ok(res, { blocked: true });
});
blocksRouter.delete('/:userId', async (req, res) => {
  const userId = parse(uuid, req.params.userId);
  await prisma.block.deleteMany({ where: { blockerId: req.user.id, blockedId: userId } });
  ok(res, { blocked: false });
});
