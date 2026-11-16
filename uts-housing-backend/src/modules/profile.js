import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { badRequest, forbidden, ok, parse } from '../utils/http.js';
import { writeLimiter } from '../middleware/security.js';
import { documentUpload, serializeDocument, toDocumentRows } from '../services/documents.js';
import { discardUploads, saveUploads } from '../services/storage.js';
import { notifyAdmins, notifyReviewers } from '../services/notify.js';
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
  gender: z.enum(['MALE', 'FEMALE'], { message: 'Choose your gender.' }).optional(),
});

router.get('/', (req, res) => ok(res, { user: serializeMe(req.user) }));

router.patch('/', async (req, res) => {
  const data = parse(profileSchema, req.body);
  if (req.user.role !== 'STUDENT') { delete data.major; delete data.academicYear; delete data.gender; }
  if (req.user.role !== 'LANDLORD') delete data.phone;
  const user = await prisma.user.update({ where: { id: req.user.id }, data });
  ok(res, { user: serializeMe(user) });
});

// Student / landlord verification: upload documents for review.
//  - students: offer letter (PDF) + student card photo → reviewed by an administrator
//  - landlords: identity card and/or company registration → reviewed by the legal reviewer
router.get('/verification', async (req, res) => {
  const items = await prisma.verification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    include: { documents: { orderBy: { createdAt: 'asc' } } },
  });
  ok(res, items.map((v) => ({
    id: v.id, type: v.type, method: v.method, status: v.status, note: v.note, decisionNote: v.decisionNote,
    createdAt: v.createdAt, reviewedAt: v.reviewedAt, documents: v.documents.map(serializeDocument),
  })));
});

const STUDENT_FIELDS = [{ name: 'offerLetter', maxCount: 1 }, { name: 'studentCard', maxCount: 2 }];
const LANDLORD_FIELDS = [{ name: 'identityCard', maxCount: 2 }, { name: 'companyRegistration', maxCount: 3 }];

router.post('/verification', writeLimiter, async (req, res) => {
  if (!['STUDENT', 'LANDLORD'].includes(req.user.role)) throw badRequest('This account type does not need verification.');
  const isStudent = req.user.role === 'STUDENT';
  const files = await documentUpload(isStudent ? STUDENT_FIELDS : LANDLORD_FIELDS)(req, res);
  const all = Object.values(files).flat();
  try {
    if (!req.user.emailVerifiedAt) throw forbidden('Please confirm your e-mail address first.');
    const already = isStudent ? req.user.studentVerifiedAt : req.user.landlordVerifiedAt;
    if (already) throw badRequest('Your account is already verified.');
    const pending = await prisma.verification.findFirst({ where: { userId: req.user.id, status: 'PENDING' } });
    if (pending) throw badRequest('You already have a verification request waiting for review.');
    const { note } = parse(z.object({ note: z.string().trim().max(1000).optional() }), req.body);

    let rows;
    if (isStudent) {
      if (!files.offerLetter?.length) throw badRequest('offerLetter: Upload your offer letter (PDF).', { offerLetter: 'Upload your offer letter (PDF).' });
      if (!files.studentCard?.length) throw badRequest('studentCard: Upload a photo of your student card.', { studentCard: 'Upload a photo of your student card.' });
      rows = [
        ...toDocumentRows(files.offerLetter, 'OFFER_LETTER', req.user.id, ['pdf']),
        ...toDocumentRows(files.studentCard, 'STUDENT_CARD', req.user.id, ['jpg', 'png', 'pdf']),
      ];
    } else {
      if (!files.identityCard?.length && !files.companyRegistration?.length)
        throw badRequest('identityCard: Upload your identity card, or your company registration if you rent as a company.', {
          identityCard: 'Upload your identity card (or company registration).',
        });
      rows = [
        ...toDocumentRows(files.identityCard || [], 'IDENTITY_CARD', req.user.id),
        ...toDocumentRows(files.companyRegistration || [], 'COMPANY_REGISTRATION', req.user.id),
      ];
    }
    await saveUploads('private', all);
    const v = await prisma.verification.create({
      data: {
        userId: req.user.id,
        type: isStudent ? 'STUDENT' : 'LANDLORD',
        method: 'DOCUMENTS',
        note,
        documents: { create: rows.map(({ ownerId: _o, ...r }) => ({ ...r, owner: { connect: { id: req.user.id } } })) },
      },
      include: { documents: true },
    });
    const payload = {
      type: 'VERIFICATION_PENDING',
      title: isStudent ? 'Student documents to review' : 'Landlord documents to review',
      body: `${req.user.name} uploaded ${isStudent ? 'an offer letter and student card' : 'identity documents'}.`,
      link: isStudent ? '/admin/verifications' : '/reviewer',
    };
    if (isStudent) await notifyAdmins(payload);
    else await notifyReviewers(payload);
    ok(res, { id: v.id, status: v.status, documents: v.documents.map(serializeDocument) }, undefined, 201);
  } catch (err) {
    await discardUploads('private', all);
    throw err;
  }
});

export default router;
