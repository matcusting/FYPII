/**
 * DEMO SEED DATA — every person, listing, address and review below is FICTITIOUS and only
 * exists so the prototype can be demonstrated. Do not run this in production.
 *
 * All demo accounts use the password:  Demo@2026
 * Admin account:                       admin@uts-housing.local / Admin@2026!
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { hashPassword } from '../src/utils/crypto.js';

const DEMO_PASSWORD = 'Demo@2026';
const ADMIN_PASSWORD = 'Admin@2026!';

/* ---- tiny PNG generator so demo listings have real (placeholder) photos ---- */
function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function gradientPng(w, h, [r1, g1, b1], [r2, g2, b2]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      const roof = y > h * 0.35 && y < h * 0.85 && x > w * 0.3 && x < w * 0.7; // simple "house" block
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = roof ? 245 : Math.round(r1 + (r2 - r1) * t);
      raw[o + 1] = roof ? 245 : Math.round(g1 + (g2 - g1) * t);
      raw[o + 2] = roof ? 250 : Math.round(b1 + (b2 - b1) * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PALETTES = [
  [[32, 53, 105], [96, 165, 250]],
  [[21, 128, 61], [134, 239, 172]],
  [[180, 83, 9], [253, 186, 116]],
  [[126, 34, 206], [216, 180, 254]],
  [[15, 23, 42], [100, 116, 139]],
  [[190, 18, 60], [253, 164, 175]],
];
function demoPhoto(i) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const key = `demo-${crypto.randomUUID()}.png`;
  const [a, b] = PALETTES[i % PALETTES.length];
  fs.writeFileSync(path.join(config.uploadDir, key), gradientPng(320, 200, a, b));
  return key;
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const day = (s) => new Date(`${s}T00:00:00Z`);

async function main() {
  console.log('Clearing existing data…');
  await prisma.$transaction([
    prisma.auditLog.deleteMany(), prisma.notification.deleteMany(), prisma.report.deleteMany(),
    prisma.message.deleteMany(), prisma.conversationParticipant.deleteMany(), prisma.conversation.deleteMany(),
    prisma.review.deleteMany(), prisma.favorite.deleteMany(), prisma.listingPhoto.deleteMany(),
    prisma.listingAmenity.deleteMany(), prisma.listing.deleteMany(), prisma.amenity.deleteMany(),
    prisma.connectionRequest.deleteMany(), prisma.block.deleteMany(), prisma.lifestyleProfile.deleteMany(),
    prisma.verification.deleteMany(), prisma.session.deleteMany(), prisma.passwordResetToken.deleteMany(),
    prisma.emailVerificationToken.deleteMany(), prisma.user.deleteMany(), prisma.campus.deleteMany(),
    prisma.university.deleteMany(),
  ]);
  if (fs.existsSync(config.uploadDir)) {
    for (const f of fs.readdirSync(config.uploadDir)) if (f.startsWith('demo-')) fs.rmSync(path.join(config.uploadDir, f));
  }

  const uts = await prisma.university.create({
    data: { name: 'University of Technology Sarawak', emailDomains: ['uts.edu.my', 'student.uts.edu.my'] },
  });
  // Approximate coordinates — administrators should confirm them in the admin portal.
  const campus = await prisma.campus.create({
    data: { universityId: uts.id, name: 'UTS Sibu Campus', latitude: 2.3121, longitude: 111.8406 },
  });

  const amenityNames = [
    'High-Speed Wi-Fi', 'Air Conditioning', 'Washing Machine', 'Water Heater', 'Study Desk', 'Microwave',
    'Private Bathroom', 'Attached Bathroom', 'Gym Access', 'Parking Lot', 'Water Dispenser', 'Balcony',
    'Cooking Allowed', 'Utilities Included', '24h Security',
  ];
  await prisma.amenity.createMany({ data: amenityNames.map((name) => ({ name })) });
  const amenities = Object.fromEntries((await prisma.amenity.findMany()).map((a) => [a.name, a.id]));

  const demoHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();

  await prisma.user.create({
    data: { name: 'System Administrator', email: 'admin@uts-housing.local', role: 'ADMIN', passwordHash: await hashPassword(ADMIN_PASSWORD), emailVerifiedAt: now },
  });

  const mkStudent = async (name, email, studentId, major, academicYear, habits, extra = {}) => {
    const verified = extra.verified !== false;
    const u = await prisma.user.create({
      data: {
        name, email, studentId, major, academicYear, gender: extra.gender, role: 'STUDENT', passwordHash: demoHash,
        emailVerifiedAt: now, studentVerifiedAt: verified ? now : null, bio: extra.bio,
        verifications: {
          create: {
            type: 'STUDENT',
            method: verified ? 'EMAIL_DOMAIN' : 'MANUAL',
            status: verified ? 'APPROVED' : 'PENDING',
            note: extra.note,
            reviewedAt: verified ? now : null,
          },
        },
        lifestyle: { create: { discoverable: verified, ...habits } },
      },
    });
    return u;
  };

  const marcus = await mkStudent('Marcus Ting', 'student@uts.edu.my', 'BCS24020031', 'Computer Science', 'Year 2',
    { studySchedule: 'Night Owl (Late)', cleanliness: 'Moderate (Weekly)', smoking: 'Non-Smoker', noise: 'Quiet', budgetMin: 300, budgetMax: 600 },
    { gender: 'MALE', bio: 'Looking for a quiet roommate near UTS campus who respects study hours.' });
  const alex = await mkStudent('Alex Lee', 'alex.lee@uts.edu.my', 'BCS23010012', 'Computer Science', 'Year 3',
    { studySchedule: 'Night Owl (Late)', cleanliness: 'Moderate (Weekly)', smoking: 'Non-Smoker', noise: 'Quiet', budgetMin: 350, budgetMax: 650 },
    { gender: 'MALE', bio: 'Gamer and coder, usually up late but quiet.' });
  const jonathan = await mkStudent('Jonathan Tan', 'jonathan.tan@uts.edu.my', 'BEE24030045', 'Engineering', 'Year 2',
    { studySchedule: 'Night Owl (Late)', cleanliness: 'Strict (Daily)', smoking: 'Non-Smoker', noise: 'Moderate', budgetMin: 300, budgetMax: 500 },
    { gender: 'MALE', bio: 'Neat freak, happy to share chores.' });
  const sarah = await mkStudent('Sarah Tan', 'sarah.tan@uts.edu.my', 'BBA24050078', 'Business', 'Year 1',
    { studySchedule: 'Early Bird (Morning)', cleanliness: 'Strict (Daily)', smoking: 'Non-Smoker', pets: 'No Pets', budgetMin: 250, budgetMax: 450 },
    { gender: 'FEMALE' });
  const daniel = await mkStudent('Daniel Wong', 'daniel.wong@uts.edu.my', 'BCE23020033', 'Civil Engineering', 'Year 3',
    { studySchedule: 'Early Bird (Morning)', cleanliness: 'Relaxed', smoking: 'Smoker', guests: 'Often' },
    { gender: 'MALE' });
  const amanda = await mkStudent('Amanda Kho', 'amanda.kho@uts.edu.my', 'BAC22040021', 'Accounting', 'Year 2',
    { studySchedule: 'Early Bird (Morning)', cleanliness: 'Moderate (Weekly)', smoking: 'Non-Smoker', roommateGender: 'ANY' },
    { verified: true, gender: 'FEMALE' });
  const jason = await mkStudent('Jason Lau', 'jason.lau@uts.edu.my', 'BCS21010099', 'Computer Science', 'Year 4',
    { studySchedule: 'Night Owl (Late)', cleanliness: 'Relaxed', smoking: 'Smoker Ok' },
    { gender: 'MALE' });
  await mkStudent('Priya Nair', 'priya.nair@gmail.com', 'BFT24060011', 'Food Technology', 'Year 1', {},
    { verified: false, gender: 'FEMALE', note: 'I use my personal Gmail; my student card number is BFT24060011, intake Sept 2026.' });

  const mkLandlord = (name, email, phone, verified = true) =>
    prisma.user.create({
      data: {
        name, email, phone, role: 'LANDLORD', passwordHash: demoHash, emailVerifiedAt: now,
        landlordVerifiedAt: verified ? now : null,
        verifications: { create: { type: 'LANDLORD', method: 'MANUAL', status: verified ? 'APPROVED' : 'PENDING', reviewedAt: verified ? now : null, note: verified ? undefined : 'I own two units in Sibu Jaya, title deed available on request.' } },
      },
    });
  const wong = await mkLandlord('Mr. Wong', 'wong@example.com', '+60 12-345 6789');
  const ling = await mkLandlord('Madam Ling', 'ling@example.com', '+60 13-222 3344');
  const tan = await mkLandlord('Mr. Tan', 'tan@example.com', '+60 16-555 0101');
  const rachel = await mkLandlord('Ms. Rachel', 'rachel@example.com', '+60 19-888 1212');
  await mkLandlord('Mr. Lim', 'lim@example.com', '+60 11-777 4545', false);

  let photoIndex = 0;
  const mkListing = async (owner, d, status = 'PUBLISHED') => {
    const l = await prisma.listing.create({
      data: {
        ownerId: owner.id, campusId: campus.id, title: d.title, description: d.description, roomType: d.roomType,
        rent: d.rent, deposit: d.deposit, distanceKm: d.distance, approximateArea: d.area, furnished: d.furnished ?? true,
        address: d.address, houseRules: d.rules, genderRestriction: d.gender ?? 'ANY', availableFrom: d.availableFrom ? day(d.availableFrom) : null, status,
        publishedAt: status === 'PUBLISHED' || status === 'RENTED' ? daysAgo(d.age ?? 5) : null,
        lastConfirmedAt: daysAgo(d.confirmed ?? 2), viewCount: d.views ?? 0, createdAt: daysAgo((d.age ?? 5) + 1),
        amenities: { create: d.facilities.map((n) => ({ amenityId: amenities[n] })) },
        photos: { create: [0, 1].map((i) => ({ objectKey: demoPhoto(photoIndex++), sortOrder: i })) },
      },
    });
    return l;
  };

  const tamanUni = await mkListing(wong, {
    title: 'Taman Universiti Room', address: 'No. 12, Lorong Universiti 3, Taman Universiti, 96000 Sibu, Sarawak', rent: 450, deposit: 900, distance: 1.2, roomType: 'Single Room', area: 'Taman Universiti',
    facilities: ['High-Speed Wi-Fi', 'Air Conditioning', 'Washing Machine', 'Water Heater', 'Study Desk'],
    description: 'Spacious and quiet single room located right next to UTS campus. Walking distance to local eateries and supermarkets. Ideal for students looking for a conducive study environment.',
    rules: 'No smoking indoors. Quiet hours after 11pm.', availableFrom: '2026-12-01', views: 64, age: 20,
  });
  const sibuJaya = await mkListing(wong, {
    title: 'Sibu Jaya Shared Apt', address: 'Block B-3-5, Jalan Sibu Jaya, 96000 Sibu, Sarawak', rent: 300, deposit: 300, distance: 3.5, roomType: 'Shared Room', area: 'Sibu Jaya',
    facilities: ['High-Speed Wi-Fi', 'Washing Machine', 'Water Heater', 'Cooking Allowed', 'Utilities Included', '24h Security'],
    description: 'Affordable shared apartment with utility bills included in the monthly rent. Friendly housemates and 24-hour security guard patrol.',
    views: 41, age: 12,
  });
  await mkListing(ling, {
    title: 'Wong King Huo Studio', address: 'Lot 88, Jalan Wong King Huo, 96000 Sibu, Sarawak', rent: 850, deposit: 1700, distance: 4.0, roomType: 'Whole Studio', area: 'Wong King Huo',
    facilities: ['High-Speed Wi-Fi', 'Air Conditioning', 'Private Bathroom', 'Gym Access', 'Microwave', 'Parking Lot'],
    description: 'Modern studio unit with full privacy. Comes with an attached bathroom, kitchenette, and free access to the apartment gym and swimming pool.',
    availableFrom: '2027-01-01', views: 22, age: 8,
  });
  await mkListing(tan, {
    title: 'Campus Walk Single', address: 'No. 5, Jalan Universiti, 96000 Sibu, Sarawak', rent: 550, deposit: 0, distance: 0.8, roomType: 'Single Room', area: 'Jalan Universiti',
    facilities: ['High-Speed Wi-Fi', 'Air Conditioning', 'Study Desk', 'Water Dispenser'],
    description: 'Superb location just 800m from UTS main gate! Zero deposit promotion for verified UTS students. Newly renovated with brand new furniture.',
    views: 87, age: 3, gender: 'MALE_ONLY',
  });
  await mkListing(rachel, {
    title: 'Pahlawan Master Room', address: 'No. 21, Jalan Pahlawan, 96000 Sibu, Sarawak', rent: 650, deposit: 650, distance: 2.5, roomType: 'Master Room', area: 'Pahlawan',
    facilities: ['High-Speed Wi-Fi', 'Air Conditioning', 'Attached Bathroom', 'Washing Machine', 'Balcony'],
    description: 'Large master bedroom with a private attached bathroom and balcony. Located near Pahlawan bus terminal and commercial center.',
    views: 15, age: 40, confirmed: 35, gender: 'FEMALE_ONLY', // stale: not reconfirmed for 35 days (auto-paused at 45)
  });
  await mkListing(wong, {
    title: 'Master Room near Lanang Road', address: 'No. 7, Jalan Lanang, 96000 Sibu, Sarawak', rent: 520, deposit: 520, distance: 2.0, roomType: 'Master Room', area: 'Lanang Road',
    facilities: ['High-Speed Wi-Fi', 'Air Conditioning', 'Attached Bathroom'],
    description: 'Newly painted master room, waiting for admin approval.',
  }, 'PENDING_REVIEW');

  // Approved + pending reviews
  await prisma.review.create({
    data: {
      listingId: tamanUni.id, landlordId: wong.id, authorId: amanda.id, rating: 5, stayFrom: day('2025-09-01'), stayTo: day('2026-06-30'),
      body: 'Mr. Wong is a fantastic landlord. The room was exactly as described on the platform, and the deposit was returned promptly at the end of the semester. Highly recommended!',
      proofNote: 'Tenancy Sept 2025 – June 2026, receipts for monthly rent available.', moderationStatus: 'APPROVED', createdAt: daysAgo(1),
    },
  });
  await prisma.review.create({
    data: {
      listingId: sibuJaya.id, landlordId: wong.id, authorId: jason.id, rating: 4, stayFrom: day('2025-01-05'), stayTo: day('2025-12-20'),
      body: 'Good location, very close to campus. Wi-Fi was occasionally slow during exam week, but the landlord was very responsive when fixing the air conditioner.',
      proofNote: 'Rented for 2025, have the signed tenancy agreement.', moderationStatus: 'APPROVED',
      reply: 'Thank you for the feedback, Jason! We have upgraded our router to Wi-Fi 6 this semester.', repliedAt: daysAgo(3), createdAt: daysAgo(6),
    },
  });
  await prisma.review.create({
    data: {
      listingId: sibuJaya.id, landlordId: wong.id, authorId: sarah.id, rating: 3, stayFrom: day('2026-01-10'),
      body: 'Decent and cheap, but the kitchen gets crowded in the evenings with everyone cooking.',
      proofNote: 'Currently renting since Jan 2026; can show DuitNow rent transfers.', moderationStatus: 'PENDING',
    },
  });

  // Conversations from the original mock-ups
  const convo = async (type, users, listingId, msgs) => {
    const c = await prisma.conversation.create({
      data: { type, listingId, participants: { create: users.map((u) => ({ userId: u.id, lastReadAt: daysAgo(10) })) } },
    });
    let t = Date.now() - msgs.length * 5 * 60000;
    for (const [sender, body] of msgs) {
      t += 5 * 60000;
      await prisma.message.create({ data: { conversationId: c.id, senderId: sender.id, body, createdAt: new Date(t) } });
    }
    await prisma.conversation.update({ where: { id: c.id }, data: { updatedAt: new Date(t) } });
    return c;
  };
  const inquiry = await convo('LISTING_INQUIRY', [marcus, wong], tamanUni.id, [
    [wong, 'Hello Marcus, thanks for your interest in the Taman Universiti Room.'],
    [marcus, 'Hi Mr. Wong! Is the security deposit negotiable?'],
    [wong, 'The room is available next month. We can discuss the deposit if you sign a 1-year lease.'],
  ]);
  // Marcus has read everything except the last landlord message
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId: inquiry.id, userId: marcus.id } },
    data: { lastReadAt: new Date(Date.now() - 2 * 60000) },
  });
  await convo('LISTING_INQUIRY', [sarah, wong], sibuJaya.id, [[sarah, 'Hi Mr. Wong, is the shared apartment still available for next semester?']]);

  await prisma.connectionRequest.create({ data: { senderId: alex.id, recipientId: marcus.id, status: 'ACCEPTED', score: 100, respondedAt: daysAgo(1) } });
  await convo('ROOMMATE', [alex, marcus], null, [
    [alex, 'Hey Marcus! I saw we have a 100% match. Want to look for an apartment together?'],
    [marcus, 'Hi Alex! Yes, that sounds great. What is your budget?'],
  ]);
  await prisma.connectionRequest.create({
    data: { senderId: jonathan.id, recipientId: marcus.id, score: 67, message: 'Hi! We are both night owls — keen to share a place near campus?' },
  });

  await prisma.favorite.create({ data: { userId: marcus.id, listingId: sibuJaya.id } });

  await prisma.notification.createMany({
    data: [
      { userId: wong.id, type: 'INQUIRY', title: 'New student inquiry', body: 'Marcus Ting asked about "Taman Universiti Room".', link: '/landlord', createdAt: daysAgo(0.1) },
      { userId: wong.id, type: 'REVIEW', title: 'New student review', body: 'A 5-star review was posted on "Taman Universiti Room".', link: '/landlord', createdAt: daysAgo(1) },
      { userId: marcus.id, type: 'CONNECTION_REQUEST', title: 'New roommate request', body: 'Jonathan Tan wants to connect with you (67% match).', link: '/student/roommates' },
    ],
  });

  console.log('\nDemo data ready (all records are fictitious).');
  console.log(`  Student : BCS24020031 / student@uts.edu.my / ${DEMO_PASSWORD}`);
  console.log(`  Landlord: wong@example.com / ${DEMO_PASSWORD}`);
  console.log(`  Admin   : admin@uts-housing.local / ${ADMIN_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
