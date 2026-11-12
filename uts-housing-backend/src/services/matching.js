/**
 * Habit-based roommate compatibility (FYP report, Chapter 4 "Roommate Matching
 * Algorithm Logic", extended per PROJECT_REQUIREMENTS.md section 8).
 *
 * Report formula (equal weights, 3 core habits):
 *     C_AB = (M(study) + M(smoke) + M(clean)) / 3 × 100%
 *     M(h) = 1 if H_A = H_B, otherwise 0
 *
 * Generalisation implemented here:
 *     C_AB = round(100 × Σ w_i · M_i / Σ w_i)   over habits BOTH students answered
 *  - w_i defaults to 1 for every habit, so with only the three core habits the
 *    result is exactly the report's formula. Students may raise a habit's
 *    importance to 2 or 3 (addresses report limitation 5.2 #2 "static weighting").
 *  - Unanswered habits are left out of numerator AND denominator.
 *  - Fewer than MIN_ANSWERED shared answers → "insufficient data", never 0%.
 *  - Hard deal-breakers (smoke-free-only vs. a smoker) remove the candidate
 *    instead of producing a misleading low score.
 */

export const DIMENSIONS = [
  { key: 'studySchedule', label: 'Study Schedule', core: true, options: ['Night Owl (Late)', 'Early Bird (Morning)'] },
  { key: 'cleanliness', label: 'Cleanliness Standard', core: true, options: ['Strict (Daily)', 'Moderate (Weekly)', 'Relaxed'] },
  { key: 'smoking', label: 'Smoking Preference', core: true, options: ['Non-Smoker', 'Smoker Ok', 'Smoker'] },
  { key: 'noise', label: 'Noise Tolerance', core: false, options: ['Quiet', 'Moderate', 'Lively'] },
  { key: 'guests', label: 'Guests at Home', core: false, options: ['Rarely', 'Sometimes', 'Often'] },
  { key: 'pets', label: 'Pets', core: false, options: ['No Pets', 'Pet Friendly'] },
];

export const MIN_ANSWERED = 3;
export const MAX_WEIGHT = 3;

/** M(h): 1 when habits are the same, 0 otherwise. */
export function habitMatch(key, a, b) {
  if (a === b) return 1;
  // Someone who is fine with smokers is compatible with a smoker.
  if (key === 'smoking') {
    const pair = new Set([a, b]);
    if (pair.has('Smoker Ok') && pair.has('Smoker')) return 1;
  }
  return 0;
}

/** Returns a reason string if the pair has a hard conflict, otherwise null. */
export function hardConflict(me, other) {
  if (me.smokeFreeOnly && other.smoking === 'Smoker') return 'You only want a smoke-free home.';
  if (other.smokeFreeOnly && me.smoking === 'Smoker') return 'They only want a smoke-free home.';
  return null;
}

export function normaliseWeights(raw) {
  const weights = {};
  for (const d of DIMENSIONS) {
    const w = Number(raw?.[d.key]);
    weights[d.key] = Number.isInteger(w) && w >= 1 && w <= MAX_WEIGHT ? w : 1;
  }
  return weights;
}

/**
 * Compare two lifestyle profiles from `me`'s point of view (my weights).
 * @returns {{ excluded: string|null, score: number|null, answered: number, breakdown: Array }}
 */
export function compatibility(me, other) {
  const excluded = hardConflict(me, other);
  const weights = normaliseWeights(me.weights);
  const breakdown = [];
  let num = 0;
  let den = 0;

  for (const d of DIMENSIONS) {
    const mine = me[d.key] ?? null;
    const theirs = other[d.key] ?? null;
    if (mine == null || theirs == null) continue;
    const m = habitMatch(d.key, mine, theirs);
    num += weights[d.key] * m;
    den += weights[d.key];
    breakdown.push({ key: d.key, label: d.label, mine, theirs, match: m === 1, weight: weights[d.key] });
  }

  const answered = breakdown.length;
  const score = den > 0 && answered >= MIN_ANSWERED ? Math.round((100 * num) / den) : null;
  return { excluded, score, answered, breakdown };
}

/** Budget ranges overlap (unknown budgets never exclude). */
export function budgetsOverlap(a, b) {
  if (a.budgetMin == null && a.budgetMax == null) return true;
  if (b.budgetMin == null && b.budgetMax == null) return true;
  const aMin = a.budgetMin ?? 0;
  const aMax = a.budgetMax ?? Infinity;
  const bMin = b.budgetMin ?? 0;
  const bMax = b.budgetMax ?? Infinity;
  return aMin <= bMax && bMin <= aMax;
}

/** Move-in dates within `toleranceDays` of each other (unknown dates never exclude). */
export function moveInCompatible(a, b, toleranceDays = 60) {
  if (!a.moveInDate || !b.moveInDate) return true;
  const diff = Math.abs(new Date(a.moveInDate) - new Date(b.moveInDate));
  return diff <= toleranceDays * 86400000;
}
