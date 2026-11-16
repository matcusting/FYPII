// FYP II features: real-time chat, listing availability upkeep, notification preferences, gender options.
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { hashPassword } from '../src/utils/crypto.js';
import { closeRealtime, initRealtime } from '../src/realtime.js';
import { runListingUpkeep } from '../src/services/jobs.js';

const app = createApp();
const PW = 'Correct-Horse-9';
// Campus used in these tests (UTS Sibu, approximately)
const CAMPUS = { lat: 2.3121, lng: 111.8406 };

let campus;
let hash;
let server;
let baseUrl;

async function makeUser(role, email, extra = {}) {
  return prisma.user.create({
    data: { role, email, name: extra.name || email.split('@')[0], passwordHash: hash, emailVerifiedAt: new Date(), ...extra },
  });
}

/** Log in through a real HTTP server and return the session cookie header. */
async function loginCookie(email) {
  const res = await request(server).post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  // Login first clears any old cookie (empty value), then sets the new one — keep only the real one, like a browser.
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');
}

function connect(cookie) {
  return ioClient(baseUrl, {
    transports: ['websocket'],
    extraHeaders: cookie ? { Cookie: cookie } : {},
    reconnection: false,
    forceNew: true,
  });
}

const once = (socket, event, ms = 4000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });

beforeAll(async () => {
  hash = await hashPassword(PW);
  const uni = await prisma.university.create({ data: { name: 'FYP2 Test University', emailDomains: ['fyp2.edu.my'] } });
  campus = await prisma.campus.create({ data: { universityId: uni.id, name: 'FYP2 Campus', latitude: CAMPUS.lat, longitude: CAMPUS.lng } });
  server = http.createServer(app);
  initRealtime(server);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  await closeRealtime();
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

/* -------------------------------------------------------- listing upkeep */

describe('listing availability upkeep', () => {
  it('reminds the owner, then pauses an unconfirmed listing; confirming restores it', async () => {
    const owner = await makeUser('LANDLORD', 'stale-owner@example.com', { landlordVerifiedAt: new Date() });
    const days = (n) => new Date(Date.now() - n * 86400000);
    const mk = (title, confirmedDaysAgo) =>
      prisma.listing.create({
        data: {
          ownerId: owner.id, campusId: campus.id, title, roomType: 'Single Room', rent: 300, distanceKm: 1,
          status: 'PUBLISHED', publishedAt: days(60), lastConfirmedAt: days(confirmedDaysAgo), photos: { create: { objectKey: 'x.png' } },
        },
      });
    const fresh = await mk('Fresh Listing', 2);
    const stale = await mk('Stale Listing', config.staleListingDays + 1);
    const old = await mk('Old Listing', config.autoPauseListingDays + 1);

    const first = await runListingUpkeep();
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect(first.paused).toBeGreaterThanOrEqual(1);

    expect((await prisma.listing.findUnique({ where: { id: fresh.id } })).status).toBe('PUBLISHED');
    const s = await prisma.listing.findUnique({ where: { id: stale.id } });
    expect(s.status).toBe('PUBLISHED');
    expect(s.staleReminderAt).not.toBeNull();
    const o = await prisma.listing.findUnique({ where: { id: old.id } });
    expect(o.status).toBe('PAUSED');

    const notes = await prisma.notification.findMany({ where: { userId: owner.id } });
    expect(notes.map((n) => n.type).sort()).toEqual(['LISTING_AUTO_PAUSED', 'LISTING_STALE']);
    expect(await prisma.auditLog.count({ where: { action: 'LISTING_AUTO_PAUSED', targetId: old.id } })).toBe(1);

    // Running again does not send a second reminder.
    await runListingUpkeep();
    expect(await prisma.notification.count({ where: { userId: owner.id, type: 'LISTING_STALE' } })).toBe(1);

    // Paused listing is hidden from search…
    const search = await request(app).get('/api/v1/listings').query({ q: 'Old Listing' });
    expect(search.body.data).toHaveLength(0);

    // …and one click on "Confirm Still Available" puts it back online without re-review.
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'stale-owner@example.com', password: PW });
    const confirm = await agent.post(`/api/v1/listings/${old.id}/availability`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('PUBLISHED');
    expect(confirm.body.data.isStale).toBe(false);
  });
});

/* -------------------------------------------- notification preferences */

describe('notification preferences', () => {
  it('users can switch e-mail notifications off and on', async () => {
    await makeUser('STUDENT', 'prefs@fyp2.edu.my', { studentId: 'BCS99990001', studentVerifiedAt: new Date() });
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'prefs@fyp2.edu.my', password: PW });
    expect((await agent.get('/api/v1/auth/me')).body.data.user.emailNotifications).toBe(true);
    const off = await agent.patch('/api/v1/profile').send({ emailNotifications: false });
    expect(off.body.data.user.emailNotifications).toBe(false);
    const row = await prisma.user.findUnique({ where: { email: 'prefs@fyp2.edu.my' } });
    expect(row.emailNotifications).toBe(false);
    expect((await agent.patch('/api/v1/profile').send({ emailNotifications: 'yes' })).status).toBe(400);
  });
});

/* -------------------------------------------------------- real-time chat */

describe('real-time messaging (WebSocket)', () => {
  it('rejects sockets without a valid session', async () => {
    const s = connect(null);
    const err = await once(s, 'connect_error');
    expect(err.message).toBe('UNAUTHENTICATED');
    s.close();
    const forged = connect('uts_sid=not-a-real-token');
    expect((await once(forged, 'connect_error')).message).toBe('UNAUTHENTICATED');
    forged.close();
  });

  it('pushes new messages, typing and notifications to the other participant only', async () => {
    const owner = await makeUser('LANDLORD', 'rt-owner@example.com', { name: 'RT Owner', landlordVerifiedAt: new Date() });
    await makeUser('STUDENT', 'rt-student@fyp2.edu.my', { name: 'RT Student', studentId: 'BCS99990002', studentVerifiedAt: new Date() });
    await makeUser('STUDENT', 'rt-outsider@fyp2.edu.my', { name: 'Outsider', studentId: 'BCS99990003', studentVerifiedAt: new Date() });
    const listing = await prisma.listing.create({
      data: {
        ownerId: owner.id, campusId: campus.id, title: 'Realtime Room', roomType: 'Single Room', rent: 500, distanceKm: 1,
        status: 'PUBLISHED', publishedAt: new Date(), photos: { create: { objectKey: 'x.png' } },
      },
    });

    const ownerCookie = await loginCookie('rt-owner@example.com');
    const studentCookie = await loginCookie('rt-student@fyp2.edu.my');
    const outsiderCookie = await loginCookie('rt-outsider@fyp2.edu.my');
    const ownerSock = connect(ownerCookie);
    const studentSock = connect(studentCookie);
    const outsiderSock = connect(outsiderCookie);
    await Promise.all([once(ownerSock, 'connect'), once(studentSock, 'connect'), once(outsiderSock, 'connect')]);

    let outsiderGotSomething = false;
    outsiderSock.on('message:new', () => { outsiderGotSomething = true; });
    outsiderSock.on('typing', () => { outsiderGotSomething = true; });

    // Student sends an inquiry → landlord receives the message and a notification instantly.
    const gotMsg = once(ownerSock, 'message:new');
    const gotNote = once(ownerSock, 'notification:new');
    const inquiry = await request(server)
      .post(`/api/v1/listings/${listing.id}/inquiries`)
      .set('Cookie', studentCookie)
      .send({ body: 'Hi, is this room still available?' });
    expect(inquiry.status).toBe(201);
    const pushed = await gotMsg;
    expect(pushed.conversationId).toBe(inquiry.body.data.conversationId);
    expect(pushed.message.body).toBe('Hi, is this room still available?');
    expect(pushed.message.mine).toBe(false);
    expect(pushed.message.senderName).toBe('RT Student');
    expect((await gotNote).type).toBe('INQUIRY');

    // Typing indicator reaches the other participant.
    const gotTyping = once(studentSock, 'typing');
    ownerSock.emit('typing', { conversationId: pushed.conversationId });
    expect(await gotTyping).toEqual({ conversationId: pushed.conversationId, name: 'RT Owner' });

    // A non-participant cannot inject typing events into the conversation.
    outsiderSock.emit('typing', { conversationId: pushed.conversationId });

    // Landlord replies via REST → student gets it in real time.
    const gotReply = once(studentSock, 'message:new');
    await request(server)
      .post(`/api/v1/conversations/${pushed.conversationId}/messages`)
      .set('Cookie', ownerCookie)
      .send({ body: 'Yes, it is!' });
    expect((await gotReply).message.body).toBe('Yes, it is!');

    await new Promise((r) => setTimeout(r, 300));
    expect(outsiderGotSomething).toBe(false);

    // Logging out disconnects that session's socket.
    const dropped = once(studentSock, 'disconnect');
    await request(server).post('/api/v1/auth/logout').set('Cookie', studentCookie);
    await dropped;

    ownerSock.close();
    outsiderSock.close();
  });
});

/* ---------------------------------------------------------- gender options */

describe('gender options', () => {
  it('students must choose a gender when registering; landlords do not', async () => {
    const base = { role: 'STUDENT', name: 'No Gender', password: PW, acceptTerms: true };
    const missing = await request(app).post('/api/v1/auth/register').send({ ...base, email: 'nog@fyp2.edu.my', studentId: 'BCS77770001' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.gender).toBe('Choose your gender.');
    const bad = await request(app).post('/api/v1/auth/register').send({ ...base, email: 'nog@fyp2.edu.my', studentId: 'BCS77770001', gender: 'OTHER' });
    expect(bad.status).toBe(400);
    const okRes = await request(app).post('/api/v1/auth/register').send({ ...base, email: 'nog@fyp2.edu.my', studentId: 'BCS77770001', gender: 'FEMALE' });
    expect(okRes.status).toBe(201);
    expect(okRes.body.data.user.gender).toBe('FEMALE');
    const landlord = await request(app).post('/api/v1/auth/register').send({ role: 'LANDLORD', name: 'Some Landlord', email: 'gl@example.com', password: PW, acceptTerms: true });
    expect(landlord.status).toBe(201);
    expect(landlord.body.data.user.gender).toBeNull();
  });

  it('roommate matching respects the same-gender preference and needs a gender', async () => {
    const habits = { studySchedule: 'Night Owl (Late)', cleanliness: 'Moderate (Weekly)', smoking: 'Non-Smoker', discoverable: true };
    const mk = (email, sid, gender, h = {}) =>
      makeUser('STUDENT', email, { studentId: sid, gender, studentVerifiedAt: new Date(), lifestyle: { create: { ...habits, ...h } } });
    await mk('g-me@fyp2.edu.my', 'GEN00001', 'FEMALE'); // default: same gender only
    await mk('g-she@fyp2.edu.my', 'GEN00002', 'FEMALE');
    await mk('g-he-any@fyp2.edu.my', 'GEN00003', 'MALE', { roommateGender: 'ANY' });
    await mk('g-nogender@fyp2.edu.my', 'GEN00004', null, { roommateGender: 'ANY' });

    const me = request.agent(app);
    await me.post('/api/v1/auth/login').send({ email: 'g-me@fyp2.edu.my', password: PW });
    let names = (await me.get('/api/v1/roommates/matches')).body.data.map((m) => m.user.name);
    expect(names).toContain('g-she');
    expect(names).not.toContain('g-he-any'); // I asked for same gender only
    expect(names).not.toContain('g-nogender');
    const sheRow = (await me.get('/api/v1/roommates/matches')).body.data.find((m) => m.user.name === 'g-she');
    expect(sheRow.gender).toBe('FEMALE');

    // A request to an excluded student is refused too.
    const he = await prisma.user.findUnique({ where: { email: 'g-he-any@fyp2.edu.my' } });
    expect((await me.post('/api/v1/roommates/requests').send({ recipientId: he.id })).status).toBe(400);

    // Switching to "any gender" lets both sides who accept any gender match.
    const put = await me.put('/api/v1/roommates/profile').send({ roommateGender: 'ANY' });
    expect(put.body.data.roommateGender).toBe('ANY');
    names = (await me.get('/api/v1/roommates/matches')).body.data.map((m) => m.user.name);
    expect(names).toContain('g-he-any');
    expect(names).not.toContain('g-nogender'); // unknown gender only matches nobody

    // A student without a gender is asked to set it before matching.
    const nog = request.agent(app);
    await nog.post('/api/v1/auth/login').send({ email: 'g-nogender@fyp2.edu.my', password: PW });
    const blocked = await nog.get('/api/v1/roommates/matches');
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/Set your gender/);
    expect((await nog.patch('/api/v1/profile').send({ gender: 'MALE' })).body.data.user.gender).toBe('MALE');
    expect((await nog.get('/api/v1/roommates/matches')).status).toBe(200);

    // Hide these students again so they do not show up in other tests' matches.
    await prisma.lifestyleProfile.updateMany({ where: { user: { email: { startsWith: 'g-' } } }, data: { discoverable: false } });
  });

  it('landlords can rent to one gender; search and inquiries respect it', async () => {
    await makeUser('LANDLORD', 'g-owner@example.com', { landlordVerifiedAt: new Date() });
    await makeUser('STUDENT', 'g-boy@fyp2.edu.my', { studentId: 'GEN10001', gender: 'MALE', studentVerifiedAt: new Date() });
    await makeUser('STUDENT', 'g-girl@fyp2.edu.my', { studentId: 'GEN10002', gender: 'FEMALE', studentVerifiedAt: new Date() });
    const owner = request.agent(app);
    await owner.post('/api/v1/auth/login').send({ email: 'g-owner@example.com', password: PW });
    const base = { roomType: 'Single Room', rent: 400, distanceKm: 1, address: '1 Jalan Gender Test, Sibu', campusId: campus.id };

    const women = await owner.post('/api/v1/listings').send({ ...base, title: 'Gender Women Only Room', genderRestriction: 'FEMALE_ONLY' });
    expect(women.status).toBe(201);
    expect(women.body.data.genderRestriction).toBe('FEMALE_ONLY');
    const open = await owner.post('/api/v1/listings').send({ ...base, title: 'Gender Open Room' });
    expect(open.body.data.genderRestriction).toBe('ANY'); // default
    expect((await owner.post('/api/v1/listings').send({ ...base, title: 'Gender Bad Room', genderRestriction: 'KIDS_ONLY' })).status).toBe(400);
    const edited = await owner.patch(`/api/v1/listings/${open.body.data.id}`).send({ genderRestriction: 'MALE_ONLY' });
    expect(edited.body.data.genderRestriction).toBe('MALE_ONLY');
    await owner.patch(`/api/v1/listings/${open.body.data.id}`).send({ genderRestriction: 'ANY' });
    await prisma.listing.updateMany({ where: { title: { startsWith: 'Gender ' } }, data: { status: 'PUBLISHED', publishedAt: new Date() } });

    // Search: "suitable for" hides rooms the student cannot rent.
    const forBoy = await request(app).get('/api/v1/listings').query({ q: 'Gender', suitableFor: 'MALE' });
    expect(forBoy.body.data.map((l) => l.title)).toEqual(['Gender Open Room']);
    const forGirl = await request(app).get('/api/v1/listings').query({ q: 'Gender', suitableFor: 'FEMALE' });
    expect(forGirl.body.data.map((l) => l.title).sort()).toEqual(['Gender Open Room', 'Gender Women Only Room']);
    const onlyRestricted = await request(app).get('/api/v1/listings').query({ q: 'Gender', genderRestriction: 'FEMALE_ONLY' });
    expect(onlyRestricted.body.data.map((l) => l.title)).toEqual(['Gender Women Only Room']);

    // Inquiries: a male student cannot ask about a women-only room; a female student can.
    const boy = request.agent(app);
    await boy.post('/api/v1/auth/login').send({ email: 'g-boy@fyp2.edu.my', password: PW });
    const refused = await boy.post(`/api/v1/listings/${women.body.data.id}/inquiries`).send({ body: 'Is it available?' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/female tenants only/);
    const girl = request.agent(app);
    await girl.post('/api/v1/auth/login').send({ email: 'g-girl@fyp2.edu.my', password: PW });
    expect((await girl.post(`/api/v1/listings/${women.body.data.id}/inquiries`).send({ body: 'Is it available?' })).status).toBe(201);
  });

  it('gender is not shown on public user cards', async () => {
    const res = await request(app).get('/api/v1/listings').query({ q: 'Gender Women Only Room' });
    expect(res.body.data[0].landlord.gender).toBeUndefined();
  });
});
