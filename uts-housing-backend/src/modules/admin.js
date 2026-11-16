import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../db.js';
import { disconnectUser } from '../realtime.js';
import { config } from '../config.js';
import { requireRole } from '../middleware/auth.js';
import { badRequest, notFound, ok, parse, uuid } from '../utils/http.js';
import { listingInclude, serializeListing, serializeMe, serializeReview } from '../services/serialize.js';
import { notify } from '../services/notify.js';
import { audit } from '../services/audit.js';
import { sendMail } from '../services/mailer.js';

const router = Router();
router.use(requireRole('ADMIN'));

const statusQuery = (values, fallback) =>
  z.object({ status: z.enum([...values, 'ALL']).default(fallback) });

/* ---------------------------------------------------------------- overview */

router.get('/overview', async (_req, res) => {
  const [pendingVerifications, pendingListings, pendingReviews, openReports, usersByRole, listingsByStatus, deletionRequests] =
    await Promise.all([
      prisma.verification.count({ where: { status: 'PENDING', method: 'MANUAL' } }),
      prisma.listing.count({ where: { status: 'PENDING_REVIEW', deletedAt: null } }),
      prisma.review.count({ where: { moderationStatus: 'PENDING' } }),
      prisma.report.count({ where: { status: 'OPEN' } }),
      prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      prisma.listing.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      prisma.user.count({ where: { status: 'DELETION_REQUESTED' } }),
    ]);
  const recent = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { actor: true } });
  ok(res, {
    pendingVerifications,
    pendingListings,
    pendingReviews,
    openReports,
    deletionRequests,
    users: Object.fromEntries(usersByRole.map((r) => [r.role, r._count._all])),
    listings: Object.fromEntries(listingsByStatus.map((r) => [r.status, r._count._all])),
    recentActions: recent.map((a) => ({ id: a.id, action: a.action, targetType: a.targetType, actor: a.actor?.name, createdAt: a.createdAt })),
  });
});

/* ----------------------------------------------------------- verifications */

router.get('/verifications', async (req, res) => {
  const { status } = parse(statusQuery(['PENDING', 'APPROVED', 'REJECTED'], 'PENDING'), req.query);
  const rows = await prisma.verification.findMany({
    where: status === 'ALL' ? {} : { status },
    include: { user: true, reviewedBy: true },
    orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
    take: 100,
  });
  ok(res, rows.map((v) => ({
    id: v.id,
    type: v.type,
    method: v.method,
    status: v.status,
    note: v.note,
    decisionNote: v.decisionNote,
    createdAt: v.createdAt,
    reviewedAt: v.reviewedAt,
    reviewedBy: v.reviewedBy?.name,
    user: serializeMe(v.user),
  })));
});

router.patch('/verifications/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { decision, note } = parse(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(500).optional() }), req.body);
  const v = await prisma.verification.findUnique({ where: { id }, include: { user: true } });
  if (!v) throw notFound();
  if (v.status !== 'PENDING') throw badRequest('This request was already decided.');
  if (decision === 'REJECTED' && !note) throw badRequest('Give a reason so the user knows what to fix.');
  const now = new Date();
  const field = v.type === 'STUDENT' ? 'studentVerifiedAt' : 'landlordVerifiedAt';
  await prisma.$transaction([
    prisma.verification.update({ where: { id }, data: { status: decision, decisionNote: note, reviewedById: req.user.id, reviewedAt: now } }),
    prisma.user.update({ where: { id: v.userId }, data: { [field]: decision === 'APPROVED' ? now : null } }),
  ]);
  await audit(req.user.id, `VERIFICATION_${decision}`, 'User', v.userId, { verificationId: id, note });
  const title = decision === 'APPROVED' ? 'Your account has been verified' : 'Verification was not approved';
  const body = decision === 'APPROVED'
    ? v.type === 'STUDENT' ? 'You can now use roommate matching and write reviews.' : 'Your listings now show the Verified Landlord badge.'
    : `Reason: ${note}. You can submit a new request from your profile.`;
  await notify(v.userId, { type: 'VERIFICATION', title, body, link: v.type === 'STUDENT' ? '/student/profile' : '/landlord' });
  await sendMail({ to: v.user.email, subject: title, text: `Hi ${v.user.name},\n\n${body}` });
  ok(res, { id, status: decision });
});

/* ------------------------------------------------------------------ listings */

router.get('/listings', async (req, res) => {
  const { status } = parse(statusQuery(['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'PAUSED', 'RENTED', 'ARCHIVED'], 'PENDING_REVIEW'), req.query);
  const rows = await prisma.listing.findMany({
    where: { deletedAt: null, ...(status === 'ALL' ? {} : { status }) },
    include: listingInclude,
    orderBy: { updatedAt: status === 'PENDING_REVIEW' ? 'asc' : 'desc' },
    take: 100,
  });
  ok(res, rows.map((l) => serializeListing(l, { includePrivate: true })));
});

router.patch('/listings/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { action, reason } = parse(
    z.object({ action: z.enum(['approve', 'reject', 'suspend']), reason: z.string().trim().max(500).optional() }),
    req.body,
  );
  const listing = await prisma.listing.findFirst({ where: { id, deletedAt: null }, include: listingInclude });
  if (!listing) throw notFound();
  if (action !== 'approve' && !reason) throw badRequest('Give a reason for the landlord.');
  let data;
  if (action === 'approve') {
    if (!listing.photos.length) throw badRequest('A listing needs at least one photo to be published.');
    data = { status: 'PUBLISHED', rejectionReason: null, publishedAt: listing.publishedAt || new Date(), lastConfirmedAt: new Date() };
  } else if (action === 'reject') {
    data = { status: 'REJECTED', rejectionReason: reason };
  } else {
    data = { status: 'PAUSED', rejectionReason: `Suspended by admin: ${reason}` };
  }
  const updated = await prisma.listing.update({ where: { id }, data, include: listingInclude });
  await audit(req.user.id, `LISTING_${action.toUpperCase()}`, 'Listing', id, { reason });
  const verb = { approve: 'approved and is now live', reject: 'was not approved', suspend: 'was suspended' }[action];
  await notify(listing.ownerId, {
    type: 'LISTING_MODERATION',
    title: `"${listing.title}" ${verb}`,
    body: reason ? `Reason: ${reason}` : 'Students can now find it in the housing search.',
    link: '/landlord',
  });
  ok(res, serializeListing(updated, { includePrivate: true }));
});

/* ------------------------------------------------------------------ reviews */

router.get('/reviews', async (req, res) => {
  const { status } = parse(statusQuery(['PENDING', 'APPROVED', 'REJECTED'], 'PENDING'), req.query);
  const rows = await prisma.review.findMany({
    where: status === 'ALL' ? {} : { moderationStatus: status },
    include: { author: true, listing: true, landlord: true },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  });
  // Signal for moderators: did the student contact the landlord about this listing in-app?
  const out = [];
  for (const r of rows) {
    const hadInquiry = await prisma.conversation.count({
      where: { listingId: r.listingId, participants: { some: { userId: r.authorId } } },
    });
    out.push({ ...serializeReview(r, { includeModeration: true }), hadInquiry: hadInquiry > 0 });
  }
  ok(res, out);
});

router.patch('/reviews/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { decision, note } = parse(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(500).optional() }), req.body);
  const review = await prisma.review.findUnique({ where: { id }, include: { listing: true } });
  if (!review) throw notFound();
  if (decision === 'REJECTED' && !note) throw badRequest('Give a reason for rejecting this review.');
  await prisma.review.update({ where: { id }, data: { moderationStatus: decision, moderationNote: note } });
  await audit(req.user.id, `REVIEW_${decision}`, 'Review', id, { note });
  await notify(review.authorId, {
    type: 'REVIEW_MODERATION',
    title: decision === 'APPROVED' ? 'Your review is now public' : 'Your review was not published',
    body: decision === 'APPROVED' ? `Thanks for reviewing "${review.listing.title}".` : `Reason: ${note}`,
    link: '/student/housing',
  });
  if (decision === 'APPROVED') {
    await notify(review.landlordId, { type: 'REVIEW', title: 'New student review', body: `A ${review.rating}-star review was posted on "${review.listing.title}".`, link: '/landlord' });
  }
  ok(res, { id, moderationStatus: decision });
});

/* ------------------------------------------------------------------ reports */

async function describeTarget(type, id) {
  if (type === 'LISTING') {
    const l = await prisma.listing.findUnique({ where: { id }, include: { owner: true } });
    return l ? { label: l.title, owner: l.owner.name, ownerId: l.ownerId, status: l.status } : null;
  }
  if (type === 'USER') {
    const u = await prisma.user.findUnique({ where: { id } });
    return u ? { label: `${u.name} (${u.email})`, ownerId: u.id, status: u.status } : null;
  }
  if (type === 'REVIEW') {
    const r = await prisma.review.findUnique({ where: { id }, include: { author: true } });
    return r ? { label: `${r.rating}★ by ${r.author.name}: ${r.body.slice(0, 140)}`, ownerId: r.authorId, status: r.moderationStatus } : null;
  }
  const m = await prisma.message.findUnique({ where: { id }, include: { sender: true } });
  return m ? { label: `${m.sender.name}: ${m.body.slice(0, 140)}`, ownerId: m.senderId } : null;
}

router.get('/reports', async (req, res) => {
  const { status } = parse(statusQuery(['OPEN', 'RESOLVED', 'DISMISSED'], 'OPEN'), req.query);
  const rows = await prisma.report.findMany({
    where: status === 'ALL' ? {} : { status },
    include: { reporter: true, resolvedBy: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  const out = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      details: r.details,
      status: r.status,
      resolution: r.resolution,
      createdAt: r.createdAt,
      reporter: r.reporter.name,
      resolvedBy: r.resolvedBy?.name,
      target: await describeTarget(r.targetType, r.targetId),
    });
  }
  ok(res, out);
});

router.patch('/reports/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { status, resolution } = parse(z.object({ status: z.enum(['RESOLVED', 'DISMISSED']), resolution: z.string().trim().min(3).max(1000) }), req.body);
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) throw notFound();
  await prisma.report.update({ where: { id }, data: { status, resolution, resolvedById: req.user.id, resolvedAt: new Date() } });
  await audit(req.user.id, `REPORT_${status}`, 'Report', id, { resolution });
  await notify(report.reporterId, { type: 'REPORT_UPDATE', title: 'Your report was reviewed', body: resolution, link: null });
  ok(res, { id, status });
});

/* -------------------------------------------------------------------- users */

router.get('/users', async (req, res) => {
  const q = parse(
    z.object({
      role: z.enum(['STUDENT', 'LANDLORD', 'ADMIN']).optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETION_REQUESTED']).optional(),
      q: z.string().trim().max(100).optional(),
    }),
    req.query,
  );
  const rows = await prisma.user.findMany({
    where: {
      role: q.role,
      status: q.status,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { studentId: { contains: q.q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  ok(res, rows.map(serializeMe));
});

router.patch('/users/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { status, reason } = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().max(500).optional() }), req.body);
  if (id === req.user.id) throw badRequest('You cannot change your own account status.');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound();
  if (user.role === 'ADMIN') throw badRequest('Administrator accounts cannot be suspended here.');
  const ops = [prisma.user.update({ where: { id }, data: { status } })];
  if (status === 'SUSPENDED') {
    ops.push(prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }));
    ops.push(prisma.listing.updateMany({ where: { ownerId: id, status: 'PUBLISHED' }, data: { status: 'PAUSED', rejectionReason: 'Owner account suspended.' } }));
    ops.push(prisma.lifestyleProfile.updateMany({ where: { userId: id }, data: { discoverable: false } }));
  }
  await prisma.$transaction(ops);
  if (status === 'SUSPENDED') disconnectUser(id);
  await audit(req.user.id, `USER_${status}`, 'User', id, { reason });
  ok(res, { id, status });
});

// Permanently delete an account (used to honour deletion requests).
router.delete('/users/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const user = await prisma.user.findUnique({ where: { id }, include: { listings: { include: { photos: true } } } });
  if (!user) throw notFound();
  if (user.role === 'ADMIN') throw badRequest('Administrator accounts cannot be deleted here.');
  const keys = user.listings.flatMap((l) => l.photos.map((p) => p.objectKey));
  await prisma.user.delete({ where: { id } });
  keys.forEach((k) => fs.rm(path.join(config.uploadDir, k), { force: true }, () => {}));
  await audit(req.user.id, 'USER_DELETED', 'User', id, { email: user.email, role: user.role });
  ok(res, { deleted: true });
});

/* ------------------------------------------------- universities & campuses */

const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Invalid domain.');

router.get('/universities', async (_req, res) => {
  const rows = await prisma.university.findMany({ include: { campuses: true }, orderBy: { name: 'asc' } });
  ok(res, rows.map((u) => ({
    id: u.id,
    name: u.name,
    emailDomains: u.emailDomains,
    campuses: u.campuses.map((c) => ({ id: c.id, name: c.name, latitude: Number(c.latitude), longitude: Number(c.longitude) })),
  })));
});

router.post('/universities', async (req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(3).max(150), emailDomains: z.array(domain).max(10).default([]) }), req.body);
  const u = await prisma.university.create({ data: d });
  await audit(req.user.id, 'UNIVERSITY_CREATED', 'University', u.id, d);
  ok(res, u, undefined, 201);
});

router.patch('/universities/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.object({ name: z.string().trim().min(3).max(150).optional(), emailDomains: z.array(domain).max(10).optional() }), req.body);
  const u = await prisma.university.update({ where: { id }, data: d });
  await audit(req.user.id, 'UNIVERSITY_UPDATED', 'University', id, d);
  ok(res, u);
});

const campusSchema = z.object({
  universityId: uuid,
  name: z.string().trim().min(2).max(150),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

router.post('/campuses', async (req, res) => {
  const d = parse(campusSchema, req.body);
  const c = await prisma.campus.create({ data: d });
  await audit(req.user.id, 'CAMPUS_CREATED', 'Campus', c.id, d);
  ok(res, c, undefined, 201);
});

router.patch('/campuses/:id', async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(campusSchema.partial(), req.body);
  const c = await prisma.campus.update({ where: { id }, data: d });
  await audit(req.user.id, 'CAMPUS_UPDATED', 'Campus', id, d);
  ok(res, c);
});

router.post('/amenities', async (req, res) => {
  const { name } = parse(z.object({ name: z.string().trim().min(2).max(60) }), req.body);
  const a = await prisma.amenity.create({ data: { name } });
  await audit(req.user.id, 'AMENITY_CREATED', 'Amenity', a.id, { name });
  ok(res, a, undefined, 201);
});

/* ----------------------------------------------------------------- audit log */

router.get('/audit-logs', async (_req, res) => {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { actor: true } });
  ok(res, rows.map((a) => ({ id: a.id, action: a.action, targetType: a.targetType, targetId: a.targetId, details: a.details, actor: a.actor?.name || 'System', createdAt: a.createdAt })));
});

export default router;
