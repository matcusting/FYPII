import { prisma } from '../db.js';

/** Append-only audit trail of sensitive (mostly admin) actions. */
export const audit = (actorId, action, targetType, targetId, details) =>
  prisma.auditLog.create({ data: { actorId, action, targetType, targetId, details } });
