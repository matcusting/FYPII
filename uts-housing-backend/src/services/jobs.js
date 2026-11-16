import { prisma } from '../db.js';
import { config } from '../config.js';
import { notify } from './notify.js';
import { audit } from './audit.js';
import { AUTO_PAUSE_REASON } from '../modules/listings.js';

/**
 * Listing availability upkeep (report limitation 5.2 #3 — "manual updates").
 *
 * Availability is still reported by the landlord, but the platform no longer
 * relies on them remembering to update it:
 *  1. After `staleListingDays` (30) without confirmation, the owner gets a
 *     reminder (in-app + e-mail) and the listing shows a "may be outdated" badge.
 *  2. After `autoPauseListingDays` (45) it is paused automatically, so students
 *     stop sending inquiries about rooms that are probably gone. One click on
 *     "Confirm Still Available" puts it back online without another review.
 */
export async function runListingUpkeep(now = new Date()) {
  const day = 86400000;
  const staleBefore = new Date(now.getTime() - config.staleListingDays * day);
  const pauseBefore = new Date(now.getTime() - config.autoPauseListingDays * day);

  const toPause = await prisma.listing.findMany({
    where: { status: 'PUBLISHED', deletedAt: null, lastConfirmedAt: { lt: pauseBefore } },
    select: { id: true, ownerId: true, title: true },
  });
  for (const l of toPause) {
    // Conditional update: skip if the owner confirmed it a moment ago.
    const { count } = await prisma.listing.updateMany({
      where: { id: l.id, status: 'PUBLISHED', lastConfirmedAt: { lt: pauseBefore } },
      data: { status: 'PAUSED', rejectionReason: AUTO_PAUSE_REASON },
    });
    if (!count) continue;
    await audit(null, 'LISTING_AUTO_PAUSED', 'Listing', l.id, { days: config.autoPauseListingDays });
    await notify(l.ownerId, {
      type: 'LISTING_AUTO_PAUSED',
      title: 'Listing paused — please confirm availability',
      body: `"${l.title}" was hidden from students because its availability was not confirmed for ${config.autoPauseListingDays} days. Open My Listings and click "Confirm Still Available" to put it back online.`,
      link: '/landlord',
    });
  }

  const toRemind = await prisma.listing.findMany({
    where: { status: 'PUBLISHED', deletedAt: null, lastConfirmedAt: { lt: staleBefore }, staleReminderAt: null },
    select: { id: true, ownerId: true, title: true },
  });
  for (const l of toRemind) {
    await prisma.listing.update({ where: { id: l.id }, data: { staleReminderAt: now } });
    const daysLeft = config.autoPauseListingDays - config.staleListingDays;
    await notify(l.ownerId, {
      type: 'LISTING_STALE',
      title: 'Is your room still available?',
      body: `"${l.title}" has not been confirmed for ${config.staleListingDays} days. Confirm it is still available, or mark it as Rented. It will be paused automatically in about ${daysLeft} days.`,
      link: '/landlord',
    });
  }

  return { reminded: toRemind.length, paused: toPause.length };
}

let timer = null;

/** Run the upkeep shortly after start-up, then every `jobIntervalMinutes`. */
export function startJobs() {
  if (config.isTest || timer) return;
  const run = () =>
    runListingUpkeep()
      .then((r) => {
        if (r.reminded || r.paused) console.log(`[jobs] listing upkeep: ${r.reminded} reminded, ${r.paused} paused`);
      })
      .catch((err) => console.error('[jobs] listing upkeep failed', err.message));
  setTimeout(run, 10000).unref();
  timer = setInterval(run, config.jobIntervalMinutes * 60000);
  timer.unref();
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}
