// Document-based verification: students (admin), landlords and properties (legal reviewer).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { hashPassword, sha256 } from '../src/utils/crypto.js';

const app = createApp();
const PW = 'Correct-Horse-9';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const pdf = (name = 'file.pdf') => [PDF, { filename: name, contentType: 'application/pdf' }];
const png = (name = 'card.png') => [PNG, { filename: name, contentType: 'image/png' }];

let campus;
let hash;

async function makeUser(role, email, extra = {}) {
  return prisma.user.create({
    data: { role, email, name: extra.name || email.split('@')[0], passwordHash: hash, emailVerifiedAt: new Date(), ...extra },
  });
}

async function login(email, role) {
  const agent = request.agent(app);
  const studentId = role === 'STUDENT' ? email.split('@')[0].toUpperCase() : undefined;
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW, role, studentId });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  hash = await hashPassword(PW);
  const uni = await prisma.university.create({ data: { name: 'Docs Test University', emailDomains: ['student.docs.edu.my'] } });
  campus = await prisma.campus.create({ data: { universityId: uni.id, name: 'Docs Campus', latitude: 2.3, longitude: 111.8 } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('student verification (admin reviews offer letter + student card)', () => {
  it('student uploads documents; only the student and admins can open them; admin approves', async () => {
    await makeUser('STUDENT', 'dst00001@student.docs.edu.my', { studentId: 'DST00001', gender: 'MALE' });
    await makeUser('STUDENT', 'dst00002@student.docs.edu.my', { studentId: 'DST00002', gender: 'MALE' });
    await makeUser('ADMIN', 'docs-admin@example.com');
    await makeUser('LEGAL_REVIEWER', 'docs-lawyer@example.com');
    const student = await login('dst00001@student.docs.edu.my', 'STUDENT');
    const other = await login('dst00002@student.docs.edu.my', 'STUDENT');
    const admin = await login('docs-admin@example.com', 'STAFF');
    const lawyer = await login('docs-lawyer@example.com', 'STAFF');

    // Both files are required, and the offer letter must really be a PDF.
    expect((await student.post('/api/v1/profile/verification').attach('offerLetter', ...pdf())).status).toBe(400);
    const fakePdf = await student.post('/api/v1/profile/verification')
      .attach('offerLetter', Buffer.from('just text'), { filename: 'offer.pdf', contentType: 'application/pdf' })
      .attach('studentCard', ...png());
    expect(fakePdf.status).toBe(400);
    expect(fakePdf.body.error.message).toMatch(/not a valid PDF/);
    const pngAsOffer = await student.post('/api/v1/profile/verification').attach('offerLetter', ...png('offer.png')).attach('studentCard', ...png());
    expect(pngAsOffer.status).toBe(400); // offer letter: PDF only
    const exe = await student.post('/api/v1/profile/verification')
      .attach('offerLetter', ...pdf()).attach('studentCard', Buffer.from('MZ'), { filename: 'card.exe', contentType: 'application/x-msdownload' });
    expect(exe.status).toBe(400);

    const sent = await student.post('/api/v1/profile/verification').field('note', 'Intake Sept 2026').attach('offerLetter', ...pdf('offer.pdf')).attach('studentCard', ...png());
    expect(sent.status).toBe(201);
    expect(sent.body.data.documents.map((d) => d.kind).sort()).toEqual(['OFFER_LETTER', 'STUDENT_CARD']);
    expect(JSON.stringify(sent.body)).not.toContain('objectKey');
    // A second request while one is pending is refused.
    expect((await student.post('/api/v1/profile/verification').attach('offerLetter', ...pdf()).attach('studentCard', ...png())).status).toBe(400);

    const docUrl = sent.body.data.documents.find((d) => d.kind === 'OFFER_LETTER').url;
    const own = await student.get(docUrl);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
    expect(own.headers['cache-control']).toMatch(/no-store/);
    expect((await other.get(docUrl)).status).toBe(404); // another student
    expect((await request(app).get(docUrl)).status).toBe(401); // not logged in
    expect((await lawyer.get(docUrl)).status).toBe(404); // reviewers never see student documents
    expect((await admin.get(docUrl)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'DOCUMENT_VIEWED' } })).toBeGreaterThan(0);
    // Not reachable as a static file either.
    const key = (await prisma.document.findFirst({ where: { kind: 'OFFER_LETTER' } })).objectKey;
    expect((await request(app).get(`/uploads/${key}`)).status).toBe(404);

    // Admin queue shows the student with the documents; reviewers cannot use it.
    const queue = await admin.get('/api/v1/admin/verifications');
    const row = queue.body.data.find((v) => v.user.email === 'dst00001@student.docs.edu.my');
    expect(row.documents).toHaveLength(2);
    expect((await lawyer.get('/api/v1/admin/verifications')).status).toBe(403);
    expect((await admin.patch(`/api/v1/admin/verifications/${row.id}`).send({ decision: 'APPROVED' })).status).toBe(200);
    expect((await student.get('/api/v1/auth/me')).body.data.user.studentVerified).toBe(true);
  });
});

describe('landlord verification (legal reviewer, once per landlord)', () => {
  it('landlord uploads IC; the admin cannot decide it; the legal reviewer approves', async () => {
    await makeUser('LANDLORD', 'docs-landlord@example.com');
    const landlord = await login('docs-landlord@example.com', 'LANDLORD');
    const admin = await login('docs-admin@example.com', 'STAFF');
    const lawyer = await login('docs-lawyer@example.com', 'STAFF');

    expect((await landlord.post('/api/v1/profile/verification').field('note', 'hi')).status).toBe(400); // no documents
    const sent = await landlord.post('/api/v1/profile/verification').attach('identityCard', ...png('ic.png'));
    expect(sent.status).toBe(201);

    // Landlords never appear in the admin's student queue, and the admin cannot decide them.
    const adminQueue = await admin.get('/api/v1/admin/verifications').query({ status: 'ALL' });
    expect(adminQueue.body.data.some((v) => v.type === 'LANDLORD')).toBe(false);
    expect((await admin.patch(`/api/v1/admin/verifications/${sent.body.data.id}`).send({ decision: 'APPROVED' })).status).toBe(400);

    const queue = await lawyer.get('/api/v1/reviewer/landlords');
    const row = queue.body.data.find((v) => v.landlord.email === 'docs-landlord@example.com');
    expect(row.documents[0].kind).toBe('IDENTITY_CARD');
    expect((await lawyer.get(row.documents[0].url)).status).toBe(200);
    expect((await lawyer.patch(`/api/v1/reviewer/landlords/${row.id}`).send({ decision: 'REJECTED' })).status).toBe(400); // reason needed
    expect((await lawyer.patch(`/api/v1/reviewer/landlords/${row.id}`).send({ decision: 'APPROVED' })).status).toBe(200);
    expect((await landlord.get('/api/v1/auth/me')).body.data.user.landlordVerified).toBe(true);

    // Reviewers have no access to the rest of the admin console or to students.
    expect((await lawyer.get('/api/v1/admin/overview')).status).toBe(403);
    expect((await lawyer.get('/api/v1/admin/users')).status).toBe(403);
  });

  it('an unverified landlord cannot submit a listing', async () => {
    await makeUser('LANDLORD', 'docs-unverified@example.com');
    const owner = await login('docs-unverified@example.com', 'LANDLORD');
    const l = await owner.post('/api/v1/listings').send({ title: 'Unverified Room', roomType: 'Single Room', rent: 300, distanceKm: 1, address: '9 Jalan Draft, Sibu', campusId: campus.id });
    await owner.post(`/api/v1/listings/${l.body.data.id}/photos`).attach('photos', ...png());
    await owner.post(`/api/v1/listings/${l.body.data.id}/documents`).field('kind', 'PROPERTY_TITLE').attach('documents', ...pdf());
    const res = await owner.post(`/api/v1/listings/${l.body.data.id}/submit`);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/identity has not been verified/);
  });
});

describe('property documents (legal reviewer, every listing)', () => {
  it('reject → fix → approve → admin publishes; a new address needs new documents', async () => {
    const owner = await login('docs-landlord@example.com', 'LANDLORD');
    const admin = await login('docs-admin@example.com', 'STAFF');
    const lawyer = await login('docs-lawyer@example.com', 'STAFF');
    const created = await owner.post('/api/v1/listings').send({
      title: 'Docs Checked Room', roomType: 'Single Room', rent: 480, distanceKm: 1.2, address: '12 Jalan Lama, Sibu', campusId: campus.id,
    });
    const id = created.body.data.id;
    expect(created.body.data.legalStatus).toBe('NOT_SUBMITTED');
    await owner.post(`/api/v1/listings/${id}/photos`).attach('photos', ...png());

    expect((await owner.post(`/api/v1/listings/${id}/documents`).field('kind', 'WHATEVER').attach('documents', ...pdf())).status).toBe(400);
    const up = await owner.post(`/api/v1/listings/${id}/documents`).field('kind', 'TENANCY_AGREEMENT').attach('documents', ...pdf('tenancy.pdf'));
    expect(up.status).toBe(201);
    expect(up.body.data.documents).toHaveLength(1);
    // Other users never see property documents in listing responses.
    expect((await request(app).get('/api/v1/listings').query({ q: 'Docs Checked' })).body.data).toHaveLength(0);

    await owner.post(`/api/v1/listings/${id}/submit`);
    const queue = (await lawyer.get('/api/v1/reviewer/properties')).body.data;
    const row = queue.find((p) => p.id === id);
    expect(row.address).toBe('12 Jalan Lama, Sibu');
    expect(row.documents[0].kind).toBe('TENANCY_AGREEMENT');
    // Cannot add or remove documents while they are under review.
    expect((await owner.post(`/api/v1/listings/${id}/documents`).field('kind', 'OTHER_PROPERTY').attach('documents', ...pdf())).status).toBe(400);

    const rejected = await lawyer.patch(`/api/v1/reviewer/properties/${id}`).send({ decision: 'REJECTED', note: 'Owner authorisation letter missing' });
    expect(rejected.status).toBe(200);
    let mine = (await owner.get('/api/v1/listings/mine')).body.data.find((l) => l.id === id);
    expect(mine.status).toBe('REJECTED');
    expect(mine.legalStatus).toBe('REJECTED');
    expect(mine.rejectionReason).toMatch(/Owner authorisation letter missing/);

    await owner.post(`/api/v1/listings/${id}/documents`).field('kind', 'OWNER_AUTHORISATION').attach('documents', ...pdf('authorisation.pdf'));
    expect((await owner.post(`/api/v1/listings/${id}/submit`)).body.data.legalStatus).toBe('PENDING');
    expect((await admin.get('/api/v1/admin/overview')).body.data.awaitingLegalListings).toBeGreaterThan(0);
    expect((await lawyer.patch(`/api/v1/reviewer/properties/${id}`).send({ decision: 'APPROVED' })).status).toBe(200);
    expect((await admin.patch(`/api/v1/admin/listings/${id}`).send({ action: 'approve' })).body.data.status).toBe('PUBLISHED');

    // Editing the price keeps the legal approval (goes back to the admin only).
    const priced = await owner.patch(`/api/v1/listings/${id}`).send({ rent: 500 });
    expect(priced.body.data.status).toBe('PENDING_REVIEW');
    expect(priced.body.data.legalStatus).toBe('APPROVED');
    await admin.patch(`/api/v1/admin/listings/${id}`).send({ action: 'approve' });

    // Changing the address hides the listing and requires new documents.
    const moved = await owner.patch(`/api/v1/listings/${id}`).send({ address: '88 Jalan Baru, Sibu' });
    expect(moved.body.data.status).toBe('DRAFT');
    expect(moved.body.data.legalStatus).toBe('NOT_SUBMITTED');
    expect(moved.body.data.documents).toHaveLength(0);
    expect((await owner.post(`/api/v1/listings/${id}/submit`)).status).toBe(400);
    expect(await prisma.document.count({ where: { listingId: id, supersededAt: { not: null } } })).toBe(2); // kept for the audit trail
  });
});

describe('legal reviewer accounts', () => {
  it('only admins create reviewers; the reviewer sets a password from the e-mail link and uses the staff login', async () => {
    const admin = await login('docs-admin@example.com', 'STAFF');
    const landlord = await login('docs-landlord@example.com', 'LANDLORD');
    expect((await landlord.post('/api/v1/admin/reviewers').send({ name: 'X', email: 'x@example.com' })).status).toBe(403);
    expect((await request(app).post('/api/v1/auth/register').send({ role: 'LEGAL_REVIEWER', name: 'Sneaky', email: 'sneaky@example.com', password: PW, acceptTerms: true })).status).toBe(400);

    const created = await admin.post('/api/v1/admin/reviewers').send({ name: 'Demo Reviewer', email: 'New.Reviewer@Example.com' });
    expect(created.status).toBe(201);
    expect((await admin.post('/api/v1/admin/reviewers').send({ name: 'Again', email: 'new.reviewer@example.com' })).status).toBe(400);
    const list = (await admin.get('/api/v1/admin/reviewers')).body.data;
    expect(list.find((r) => r.email === 'new.reviewer@example.com').passwordSet).toBe(false);

    // Simulate the e-mailed link (only its hash is stored).
    const user = await prisma.user.findUnique({ where: { email: 'new.reviewer@example.com' } });
    const token = 'reviewer-setup-token-abcdefgh';
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60000) } });
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Reviewer-Pass-77' })).status).toBe(200);

    const reviewer = request.agent(app);
    expect((await reviewer.post('/api/v1/auth/login').send({ role: 'LANDLORD', email: 'new.reviewer@example.com', password: 'Reviewer-Pass-77' })).status).toBe(401);
    expect((await reviewer.post('/api/v1/auth/login').send({ role: 'STAFF', email: 'new.reviewer@example.com', password: 'Reviewer-Pass-77' })).status).toBe(200);
    expect((await reviewer.get('/api/v1/reviewer/overview')).status).toBe(200);
    expect((await admin.get('/api/v1/admin/reviewers')).body.data.find((r) => r.email === 'new.reviewer@example.com').passwordSet).toBe(true);
  });
});
