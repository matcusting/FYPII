import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { badRequest, notFound, ok, parse, uuid } from '../utils/http.js';
import { serializeDocument } from '../services/documents.js';
import { notify, notifyAdmins } from '../services/notify.js';
import { audit } from '../services/audit.js';

/**
 * Legal reviewer portal.
 *
 * A legal reviewer (e.g. a lawyer engaged by the platform) checks:
 *  1. each landlord's identity — once per landlord;
 *  2. each property's ownership / right-to-rent documents — before the listing
 *     goes to the administrator for the usual content check.
 * Reviewers cannot see students, chats or any other admin area.
 */
const router = Router();
router.use(requireRole('LEGAL_REVIEWER'));

const statusQuery = (values, fallback) => z.object({ status: z.enum([...values, 'ALL']).default(fallback) });
const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(1000).optional(),
});

const landlordInfo = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, verified: Boolean(u.landlordVerifiedAt), createdAt: u.createdAt });

router.get('/overview', async (_req, res) => {
  const [landlords, properties] = await Promise.all([
    prisma.verification.count({ where: { type: 'LANDLORD', status: 'PENDING', documents: { some: {} } } }),
    prisma.listing.count({ where: { legalStatus: 'PENDING', deletedAt: null } }),
  ]);
  ok(res, { pendingLandlords: landlords, pendingProperties: properties });
});

/* ------------------------------------------------------ landlord identity */

router.get('/landlords', async (req, res) => {
  const { status } = parse(statusQuery(['PENDING', 'APPROVED', 'REJECTED'], 'PENDING'), req.query);
  const rows = await prisma.verification.findMany({
    where: { type: 'LANDLORD', documents: { some: {} }, ...(status === 'ALL' ? {} : { status }) },
    include: { user: true, reviewedBy: true, documents: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
    take: 100,
  });
  ok(res, rows.map((v) => ({
    id: v.id,
    status: v.status,
    note: v.note,
    decisionNote: v.decisionNote,
    createdAt: v.createdAt,
    reviewedAt: v.reviewedAt,
    reviewedBy: v.reviewedBy?.name,
    landlord: landlordInfo(v.user),
    documents: v.documents.map(serializeDocument),
  })));
});

router.patch('/landlords/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { decision, note } = parse(decisionSchema, req.body);
  const v = await prisma.verification.findFirst({ where: { id, type: 'LANDLORD' }, include: { user: true } });
  if (!v) throw notFound();
  if (v.status !== 'PENDING') throw badRequest('This request was already decided.');
  if (decision === 'REJECTED' && !note) throw badRequest('Give a reason so the landlord knows what to fix.');
  const now = new Date();
  await prisma.$transaction([
    prisma.verification.update({ where: { id }, data: { status: decision, decisionNote: note, reviewedById: req.user.id, reviewedAt: now } }),
    prisma.user.update({ where: { id: v.userId }, data: { landlordVerifiedAt: decision === 'APPROVED' ? now : null } }),
  ]);
  await audit(req.user.id, `LANDLORD_VERIFICATION_${decision}`, 'User', v.userId, { verificationId: id, note });
  await notify(v.userId, {
    type: 'VERIFICATION',
    title: decision === 'APPROVED' ? 'Your landlord identity is verified' : 'Landlord verification was not approved',
    body: decision === 'APPROVED'
      ? 'You can now submit properties. Each property still needs its ownership documents checked before it goes live.'
      : `Reason: ${note}. Upload corrected documents in Account Settings.`,
    link: '/landlord',
  });
  ok(res, { id, status: decision });
});

/* --------------------------------------------------- property documents */

const propertyRow = (l) => ({
  id: l.id,
  title: l.title,
  status: l.status,
  legalStatus: l.legalStatus,
  legalNote: l.legalNote,
  legalReviewedAt: l.legalReviewedAt,
  legalReviewedBy: l.legalReviewedBy?.name,
  address: l.address,
  approximateArea: l.approximateArea,
  roomType: l.roomType,
  rent: Number(l.rent),
  updatedAt: l.updatedAt,
  landlord: landlordInfo(l.owner),
  ownerRole: l.owner.role,
  documents: l.documents.map(serializeDocument),
});

router.get('/properties', async (req, res) => {
  const { status } = parse(statusQuery(['PENDING', 'APPROVED', 'REJECTED'], 'PENDING'), req.query);
  const rows = await prisma.listing.findMany({
    where: { deletedAt: null, ...(status === 'ALL' ? { legalStatus: { not: 'NOT_SUBMITTED' } } : { legalStatus: status }) },
    include: { owner: true, legalReviewedBy: true, documents: { where: { supersededAt: null }, orderBy: { createdAt: 'asc' } } },
    orderBy: { updatedAt: status === 'PENDING' ? 'asc' : 'desc' },
    take: 100,
  });
  ok(res, rows.map(propertyRow));
});

router.patch('/properties/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { decision, note } = parse(decisionSchema, req.body);
  const listing = await prisma.listing.findFirst({ where: { id, deletedAt: null } });
  if (!listing) throw notFound();
  if (listing.legalStatus !== 'PENDING') throw badRequest('This property is not waiting for a legal check.');
  if (decision === 'REJECTED' && !note) throw badRequest('Give a reason so the landlord knows which documents to provide.');
  const now = new Date();
  const data = { legalStatus: decision, legalNote: note ?? null, legalReviewedAt: now, legalReviewedById: req.user.id };
  // A rejected property cannot go to the admin; it goes back to the landlord.
  if (decision === 'REJECTED') Object.assign(data, { status: 'REJECTED', rejectionReason: `Property documents not accepted: ${note}` });
  await prisma.listing.update({ where: { id }, data });
  await audit(req.user.id, `PROPERTY_LEGAL_${decision}`, 'Listing', id, { note });
  if (decision === 'APPROVED') {
    await notify(listing.ownerId, {
      type: 'LISTING_MODERATION',
      title: `Documents for "${listing.title}" accepted`,
      body: 'The legal check is complete. An administrator will now review the listing details.',
      link: '/landlord',
    });
    if (listing.status === 'PENDING_REVIEW') {
      await notifyAdmins({ type: 'LISTING_PENDING', title: 'Listing ready for approval', body: `"${listing.title}" passed the legal document check.`, link: '/admin/listings' });
    }
  } else {
    await notify(listing.ownerId, {
      type: 'LISTING_MODERATION',
      title: `Documents for "${listing.title}" were not accepted`,
      body: `Reason: ${note}. Upload the correct documents and submit the listing again.`,
      link: '/landlord',
    });
  }
  ok(res, { id, legalStatus: decision });
});

export default router;
