// API integration tests — acceptance scenarios from PROJECT_REQUIREMENTS.md §13.1
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { hashPassword, sha256 } from '../src/utils/crypto.js';

const app = createApp();
const PW = 'Correct-Horse-9';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let campus;
let hash;

async function makeUser(role, email, extra = {}) {
  return prisma.user.create({
    data: { role, email, name: extra.name || email.split('@')[0], passwordHash: hash, emailVerifiedAt: new Date(), ...extra },
  });
}

async function agentFor(email, role, studentId) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW, role, studentId });
  expect(res.status).toBe(200);
  return agent;
}

async function publishedListing(owner, data = {}) {
  return prisma.listing.create({
    data: {
      ownerId: owner.id, campusId: campus.id, title: data.title || 'Test Room Near Campus', roomType: 'Single Room',
      rent: data.rent ?? 400, deposit: data.deposit ?? 400, distanceKm: data.distanceKm ?? 1, status: 'PUBLISHED',
      publishedAt: new Date(), availableFrom: data.availableFrom, photos: { create: { objectKey: 'x.png' } },
    },
  });
}

beforeAll(async () => {
  hash = await hashPassword(PW);
  const uni = await prisma.university.create({ data: { name: 'University of Technology Sarawak', emailDomains: ['student.uts.edu.my'] } });
  campus = await prisma.campus.create({ data: { universityId: uni.id, name: 'Main', latitude: 2.31, longitude: 111.84 } });
  await prisma.amenity.createMany({ data: [{ name: 'High-Speed Wi-Fi' }, { name: 'Air Conditioning' }] });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('authentication & student verification', () => {
  it('registers a UTS student with the student e-mail; confirming the e-mail does not verify student status', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/v1/auth/register').send({
      role: 'STUDENT', name: 'New Student', email: 'BCS26000001@Student.UTS.edu.my', password: PW, acceptTerms: true, studentId: 'bcs26000001', gender: 'FEMALE',
    });
    expect(reg.status).toBe(201);
    expect(reg.body.data.user.email).toBe('bcs26000001@student.uts.edu.my');
    expect(reg.body.data.user.studentVerified).toBe(false);
    expect(JSON.stringify(reg.body)).not.toContain('passwordHash');

    // Before verification: matching is blocked
    expect((await agent.get('/api/v1/roommates/matches')).status).toBe(403);

    const user = await prisma.user.findUnique({ where: { email: 'bcs26000001@student.uts.edu.my' } });
    const token = 'known-test-token-1234567890';
    await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60000) } });
    expect((await agent.post('/api/v1/auth/verify-email').send({ token })).status).toBe(200);
    const me = await agent.get('/api/v1/auth/me');
    expect(me.body.data.user.emailVerified).toBe(true);
    expect(me.body.data.user.studentVerified).toBe(false); // an admin must still check the documents
    // token is single-use
    expect((await agent.post('/api/v1/auth/verify-email').send({ token })).status).toBe(400);
  });

  it('only accepts the university student e-mail, and the Student ID must match it', async () => {
    const base = { role: 'STUDENT', name: 'Some Student', password: PW, acceptTerms: true, gender: 'MALE' };
    const gmail = await request(app).post('/api/v1/auth/register').send({ ...base, email: 'bcs26000002@gmail.com', studentId: 'BCS26000002' });
    expect(gmail.status).toBe(400);
    expect(gmail.body.error.fields.email).toMatch(/student\.uts\.edu\.my/);
    const staff = await request(app).post('/api/v1/auth/register').send({ ...base, email: 'bcs26000002@uts.edu.my', studentId: 'BCS26000002' });
    expect(staff.status).toBe(400); // staff domain is not a student domain
    const mismatch = await request(app).post('/api/v1/auth/register').send({ ...base, email: 'bcs26000003@student.uts.edu.my', studentId: 'BCS26000002' });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.fields.studentId).toMatch(/must match/);
    const good = await request(app).post('/api/v1/auth/register').send({ ...base, email: 'bcs26000002@student.uts.edu.my', studentId: 'BCS26000002' });
    expect(good.status).toBe(201);
  });

  it('rejects weak passwords and missing terms', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ role: 'LANDLORD', name: 'X Y', email: 'x@y.com', password: 'password123', acceptTerms: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('fails student login when Student ID does not match the e-mail', async () => {
    await makeUser('STUDENT', 'match@uts.edu.my', { studentId: 'BCS11111111', studentVerifiedAt: new Date() });
    const bad = await request(app).post('/api/v1/auth/login').send({ role: 'STUDENT', email: 'match@uts.edu.my', studentId: 'BCS22222222', password: PW });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toMatch(/Student ID does not match/);
    const wrongPw = await request(app).post('/api/v1/auth/login').send({ email: 'match@uts.edu.my', password: 'nope-nope' });
    expect(wrongPw.body.error.message).toBe('Incorrect e-mail or password.');
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@uts.edu.my', password: 'nope-nope' });
    expect(unknown.body.error.message).toBe('Incorrect e-mail or password.'); // no user enumeration
  });

  it('password reset tokens are single-use and revoke sessions', async () => {
    const u = await makeUser('LANDLORD', 'reset@example.com');
    const agent = await agentFor('reset@example.com');
    const token = 'reset-token-abcdefghijklmnop';
    await prisma.passwordResetToken.create({ data: { userId: u.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60000) } });
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Brand-New-Pass-1' })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Another-Pass-22' })).status).toBe(400);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    const expired = 'expired-token-abcdefghijklmn';
    await prisma.passwordResetToken.create({ data: { userId: u.id, tokenHash: sha256(expired), expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token: expired, password: 'Brand-New-Pass-3' })).status).toBe(400);
  });

  it('blocks cross-site state-changing requests', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });
});

describe('listings, moderation and search', () => {
  it('a new listing is not public until an admin approves it', async () => {
    await makeUser('LANDLORD', 'owner@example.com', { landlordVerifiedAt: new Date() });
    await makeUser('ADMIN', 'admin@example.com');
    await makeUser('LEGAL_REVIEWER', 'lawyer@example.com');
    const owner = await agentFor('owner@example.com');
    const admin = await agentFor('admin@example.com');
    const lawyer = await agentFor('lawyer@example.com', 'STAFF');

    const created = await owner.post('/api/v1/listings').send({
      title: 'Moderated Room', roomType: 'Single Room', rent: 500, deposit: 500, distanceKm: 2, facilities: ['High-Speed Wi-Fi'],
      address: 'No. 1, Jalan Test, 96000 Sibu',
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    // cannot submit without a photo
    expect((await owner.post(`/api/v1/listings/${id}/submit`)).status).toBe(400);
    // reject non-images even with an image MIME type
    const fake = await owner.post(`/api/v1/listings/${id}/photos`).attach('photos', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const up = await owner.post(`/api/v1/listings/${id}/photos`).attach('photos', PNG, { filename: 'room.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    // cannot submit without property ownership documents
    expect((await owner.post(`/api/v1/listings/${id}/submit`)).body.error.message).toMatch(/ownership documents/);
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    expect((await owner.post(`/api/v1/listings/${id}/documents`).field('kind', 'PROPERTY_TITLE').attach('documents', PDF, { filename: 'title.pdf', contentType: 'application/pdf' })).status).toBe(201);
    const submitted = await owner.post(`/api/v1/listings/${id}/submit`);
    expect(submitted.body.data.status).toBe('PENDING_REVIEW');
    expect(submitted.body.data.legalStatus).toBe('PENDING');
    // the admin cannot approve before the legal check
    expect((await admin.patch(`/api/v1/admin/listings/${id}`).send({ action: 'approve' })).status).toBe(400);
    expect((await lawyer.patch(`/api/v1/reviewer/properties/${id}`).send({ decision: 'APPROVED' })).status).toBe(200);

    expect((await request(app).get(`/api/v1/listings/${id}`)).status).toBe(404);
    const search = await request(app).get('/api/v1/listings').query({ q: 'Moderated' });
    expect(search.body.data).toHaveLength(0);

    const approved = await admin.patch(`/api/v1/admin/listings/${id}`).send({ action: 'approve' });
    expect(approved.body.data.status).toBe('PUBLISHED');
    expect((await request(app).get(`/api/v1/listings/${id}`)).status).toBe(200);

    const log = await prisma.auditLog.findFirst({ where: { action: 'LISTING_APPROVE', targetId: id } });
    expect(log).toBeTruthy();
  });

  it('stores the address and gives students a Google Maps link to it', async () => {
    const owner = await agentFor('owner@example.com');
    const base = { title: 'Address Room', roomType: 'Single Room', rent: 450, distanceKm: 1.5 };
    expect((await owner.post('/api/v1/listings').send(base)).status).toBe(400); // address required

    const created = await owner.post('/api/v1/listings').send({ ...base, address: 'No. 12, Lorong Universiti 3, 96000 Sibu' });
    expect(created.status).toBe(201);
    const l = created.body.data;
    expect(l.distanceKm).toBe(1.5); // landlord-entered distance kept as is
    expect(l.googleMapsUrl).toBe('https://www.google.com/maps/search/?api=1&query=No.%2012%2C%20Lorong%20Universiti%203%2C%2096000%20Sibu');

    await prisma.listing.update({ where: { id: l.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    await makeUser('STUDENT', 'addr@uts.edu.my', { studentId: 'ADR00001', studentVerifiedAt: new Date() });
    const student = await agentFor('addr@uts.edu.my', 'STUDENT', 'ADR00001');
    const seen = await student.get(`/api/v1/listings/${l.id}`);
    expect(seen.body.data.address).toBe('No. 12, Lorong Universiti 3, 96000 Sibu');
    expect(seen.body.data.googleMapsUrl).toContain('google.com/maps/search');
    expect(seen.body.data.mapUrl).toBeUndefined(); // raw field is owner-only
    // Anonymous visitors of the public API do not get the address
    const anon = await request(app).get(`/api/v1/listings/${l.id}`);
    expect(anon.body.data.address).toBeUndefined();

    // A pasted Google Maps link takes priority; other links are refused
    const pin = 'https://maps.app.goo.gl/AbCdEf123';
    const patched = await owner.patch(`/api/v1/listings/${l.id}`).send({ mapUrl: pin });
    expect(patched.body.data.googleMapsUrl).toBe(pin);
    for (const bad of ['javascript:alert(1)', 'https://evil.example/maps', 'http://maps.app.goo.gl/x']) {
      const r = await owner.patch(`/api/v1/listings/${l.id}`).send({ mapUrl: bad });
      expect(r.status).toBe(400);
    }
  });

  it('another user cannot edit or delete a listing (404, no leakage)', async () => {
    const owner = await prisma.user.findUnique({ where: { email: 'owner@example.com' } });
    const l = await publishedListing(owner);
    await makeUser('LANDLORD', 'intruder@example.com');
    const intruder = await agentFor('intruder@example.com');
    expect((await intruder.patch(`/api/v1/listings/${l.id}`).send({ rent: 1 })).status).toBe(404);
    expect((await intruder.delete(`/api/v1/listings/${l.id}`)).status).toBe(404);
  });

  it('search respects rent, deposit, distance and availability filters', async () => {
    const owner = await prisma.user.findUnique({ where: { email: 'owner@example.com' } });
    await publishedListing(owner, { title: 'Filter Cheap Close', rent: 300, deposit: 0, distanceKm: 0.5, availableFrom: new Date('2026-01-01') });
    await publishedListing(owner, { title: 'Filter Pricey Far', rent: 900, deposit: 1800, distanceKm: 6, availableFrom: new Date('2027-06-01') });
    const q = (query) => request(app).get('/api/v1/listings').query({ q: 'Filter', ...query }).then((r) => r.body.data.map((l) => l.title));
    expect(await q({ maxRent: 500 })).toEqual(['Filter Cheap Close']);
    expect(await q({ maxDeposit: 0 })).toEqual(['Filter Cheap Close']);
    expect(await q({ maxDistance: 2 })).toEqual(['Filter Cheap Close']);
    expect(await q({ availableBy: '2026-12-31' })).toEqual(['Filter Cheap Close']);
    expect(await q({ sort: 'rent_desc' })).toEqual(['Filter Pricey Far', 'Filter Cheap Close']);
    const bad = await request(app).get('/api/v1/listings').query({ sort: 'DROP TABLE' });
    expect(bad.status).toBe(400);
  });
});

describe('roommate matching', () => {
  it('ranks verified, discoverable students and excludes deal-breakers', async () => {
    const habits = { studySchedule: 'Night Owl (Late)', cleanliness: 'Moderate (Weekly)', smoking: 'Non-Smoker', discoverable: true };
    const mk = (email, sid, h) => makeUser('STUDENT', email, { studentId: sid, gender: 'MALE', studentVerifiedAt: new Date(), lifestyle: { create: { ...habits, ...h } } });
    await mk('rm-me@uts.edu.my', 'RM000001', { smokeFreeOnly: true });
    await mk('rm-twin@uts.edu.my', 'RM000002', {});
    await mk('rm-diff@uts.edu.my', 'RM000003', { cleanliness: 'Relaxed' });
    await mk('rm-smoker@uts.edu.my', 'RM000004', { smoking: 'Smoker' });
    await mk('rm-hidden@uts.edu.my', 'RM000005', { discoverable: false });

    const me = await agentFor('rm-me@uts.edu.my', 'STUDENT', 'RM000001');
    const res = await me.get('/api/v1/roommates/matches');
    expect(res.status).toBe(200);
    const byEmail = Object.fromEntries(res.body.data.map((m) => [m.user.name, m.score]));
    expect(byEmail['rm-twin']).toBe(100);
    expect(byEmail['rm-diff']).toBe(67);
    expect(byEmail['rm-smoker']).toBeUndefined(); // deal-breaker
    expect(byEmail['rm-hidden']).toBeUndefined(); // not discoverable
    expect(res.body.data[0].user.name).toBe('rm-twin');

    // connection request → accept → conversation exists
    const twin = await prisma.user.findUnique({ where: { email: 'rm-twin@uts.edu.my' } });
    const sent = await me.post('/api/v1/roommates/requests').send({ recipientId: twin.id, message: 'Hi!' });
    expect(sent.status).toBe(201);
    const twinAgent = await agentFor('rm-twin@uts.edu.my', 'STUDENT', 'RM000002');
    expect((await twinAgent.patch(`/api/v1/roommates/requests/${sent.body.data.id}`).send({ action: 'accept' })).status).toBe(200);
    const convos = await twinAgent.get('/api/v1/conversations');
    expect(convos.body.data.some((c) => c.type === 'ROOMMATE')).toBe(true);

    // blocked users disappear from matches
    await me.post(`/api/v1/blocks/${twin.id}`);
    const after = await me.get('/api/v1/roommates/matches');
    expect(after.body.data.map((m) => m.user.name)).not.toContain('rm-twin');
  });
});

describe('verified reviews', () => {
  it('only verified students can review; pending reviews stay hidden until approved', async () => {
    const owner = await prisma.user.findUnique({ where: { email: 'owner@example.com' } });
    const l = await publishedListing(owner, { title: 'Reviewable Room' });
    await makeUser('STUDENT', 'unverified@uts.edu.my', { studentId: 'UNV00001' });
    await makeUser('STUDENT', 'reviewer@uts.edu.my', { studentId: 'REV00001', studentVerifiedAt: new Date() });
    const body = { rating: 4, body: 'Clean room, landlord fixes things quickly.', stayFrom: '2025-01-01', proofNote: 'Rented Jan–Dec 2025 with receipts' };

    const unverified = await agentFor('unverified@uts.edu.my', 'STUDENT', 'UNV00001');
    expect((await unverified.post(`/api/v1/listings/${l.id}/reviews`).send(body)).status).toBe(403);
    const ownerAgent = await agentFor('owner@example.com');
    expect((await ownerAgent.post(`/api/v1/listings/${l.id}/reviews`).send(body)).status).toBe(403);

    const reviewer = await agentFor('reviewer@uts.edu.my', 'STUDENT', 'REV00001');
    const created = await reviewer.post(`/api/v1/listings/${l.id}/reviews`).send(body);
    expect(created.status).toBe(201);
    expect((await reviewer.post(`/api/v1/listings/${l.id}/reviews`).send(body)).status).toBe(400); // one per listing
    expect((await reviewer.post(`/api/v1/listings/${l.id}/reviews`).send({ ...body, rating: 6 })).status).toBe(400);

    const publicBefore = await request(app).get(`/api/v1/listings/${l.id}/reviews`);
    expect(publicBefore.body.data.reviews).toHaveLength(0);

    const admin = await agentFor('admin@example.com');
    expect((await admin.patch(`/api/v1/admin/reviews/${created.body.data.id}`).send({ decision: 'REJECTED' })).status).toBe(400); // needs a reason
    await admin.patch(`/api/v1/admin/reviews/${created.body.data.id}`).send({ decision: 'APPROVED' });
    const publicAfter = await request(app).get(`/api/v1/listings/${l.id}/reviews`);
    expect(publicAfter.body.data.reviews).toHaveLength(1);
    expect(publicAfter.body.data.reviews[0].proofNote).toBeUndefined(); // proof stays private
    expect(publicAfter.body.data.summary.average).toBe(4);

    // landlord can reply but not edit
    const reply = await ownerAgent.post(`/api/v1/reviews/${created.body.data.id}/reply`).send({ reply: 'Thanks!' });
    expect(reply.body.data.reply).toBe('Thanks!');
    expect((await ownerAgent.patch(`/api/v1/reviews/${created.body.data.id}`).send(body)).status).toBe(403);
  });
});

describe('admin access control', () => {
  it('non-admins cannot reach admin endpoints', async () => {
    const owner = await agentFor('owner@example.com');
    expect((await owner.get('/api/v1/admin/overview')).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/overview')).status).toBe(401);
  });

  it('suspending a user ends their sessions and hides their listings', async () => {
    const u = await makeUser('LANDLORD', 'bad@example.com');
    const l = await publishedListing(u, { title: 'Soon Hidden' });
    const bad = await agentFor('bad@example.com');
    const admin = await agentFor('admin@example.com');
    await admin.patch(`/api/v1/admin/users/${u.id}`).send({ status: 'SUSPENDED', reason: 'spam' });
    expect((await bad.get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get(`/api/v1/listings/${l.id}`)).status).toBe(404);
  });
});

describe('health', () => {
  it('reports database readiness', async () => {
    expect((await request(app).get('/health/live')).body.status).toBe('ok');
    expect((await request(app).get('/health/ready')).body.database).toBe('up');
  });
});
