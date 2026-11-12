import { Router } from 'express';
import { prisma } from '../db.js';
import { ok } from '../utils/http.js';
import { DIMENSIONS, MAX_WEIGHT } from '../services/matching.js';
import { ROOM_TYPES, REPORT_REASONS } from './constants.js';

const router = Router();

// Reference data the frontend uses to build forms and filters.
router.get('/', async (_req, res) => {
  const [amenities, campuses] = await Promise.all([
    prisma.amenity.findMany({ orderBy: { name: 'asc' } }),
    prisma.campus.findMany({ include: { university: true }, orderBy: { name: 'asc' } }),
  ]);
  ok(res, {
    amenities: amenities.map((a) => a.name),
    campuses: campuses.map((c) => ({ id: c.id, name: c.name, university: c.university.name })),
    roomTypes: ROOM_TYPES,
    lifestyleDimensions: DIMENSIONS,
    maxWeight: MAX_WEIGHT,
    reportReasons: REPORT_REASONS,
  });
});

export default router;
