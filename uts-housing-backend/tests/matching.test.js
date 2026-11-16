import { describe, expect, it } from 'vitest';
import { budgetsOverlap, compatibility, genderConflict, habitMatch, moveInCompatible } from '../src/services/matching.js';

const base = { studySchedule: 'Night Owl (Late)', cleanliness: 'Moderate (Weekly)', smoking: 'Non-Smoker', weights: {}, gender: 'MALE', roommateGender: 'SAME' };

describe('roommate compatibility (report formula)', () => {
  it('gives 100% when all three core habits are identical', () => {
    expect(compatibility(base, { ...base }).score).toBe(100);
  });

  it('matches the report formula C = (M_study + M_smoke + M_clean) / 3 × 100%', () => {
    expect(compatibility(base, { ...base, cleanliness: 'Strict (Daily)' }).score).toBe(67);
    expect(compatibility(base, { ...base, cleanliness: 'Strict (Daily)', studySchedule: 'Early Bird (Morning)' }).score).toBe(33);
    expect(compatibility(base, { studySchedule: 'Early Bird (Morning)', cleanliness: 'Relaxed', smoking: 'Smoker' }).score).toBe(0);
  });

  it('ignores habits that only one student answered (no divide-by-zero)', () => {
    const me = { ...base, noise: 'Quiet', pets: 'No Pets' };
    const r = compatibility(me, { ...base });
    expect(r.answered).toBe(3);
    expect(r.score).toBe(100);
  });

  it('returns insufficient data (null), never 0%, when fewer than 3 habits overlap', () => {
    const r = compatibility({ studySchedule: 'Night Owl (Late)', weights: {} }, { studySchedule: 'Night Owl (Late)' });
    expect(r.score).toBeNull();
    expect(compatibility({ weights: {} }, {}).score).toBeNull();
  });

  it('applies importance weights chosen by the student', () => {
    const me = { ...base, weights: { cleanliness: 3 } };
    // cleanliness mismatch weighted 3 of 5 total → 2/5 = 40%
    expect(compatibility(me, { ...base, cleanliness: 'Relaxed' }).score).toBe(40);
  });

  it('excludes candidates with a smoke-free deal-breaker conflict', () => {
    const me = { ...base, smokeFreeOnly: true };
    expect(compatibility(me, { ...base, smoking: 'Smoker' }).excluded).toBeTruthy();
    expect(compatibility({ ...base, smoking: 'Smoker' }, me).excluded).toBeTruthy();
    expect(compatibility(me, { ...base, smoking: 'Smoker Ok' }).excluded).toBeNull();
  });

  it('treats "Smoker Ok" as compatible with a smoker', () => {
    expect(habitMatch('smoking', 'Smoker Ok', 'Smoker')).toBe(1);
    expect(habitMatch('smoking', 'Non-Smoker', 'Smoker Ok')).toBe(0);
  });

  it('checks budget overlap and move-in tolerance', () => {
    expect(budgetsOverlap({ budgetMin: 300, budgetMax: 500 }, { budgetMin: 450, budgetMax: 700 })).toBe(true);
    expect(budgetsOverlap({ budgetMin: 300, budgetMax: 400 }, { budgetMin: 450, budgetMax: 700 })).toBe(false);
    expect(budgetsOverlap({}, { budgetMin: 900 })).toBe(true);
    expect(moveInCompatible({ moveInDate: '2026-01-01' }, { moveInDate: '2026-02-15' })).toBe(true);
    expect(moveInCompatible({ moveInDate: '2026-01-01' }, { moveInDate: '2026-06-01' })).toBe(false);
  });
});

describe('roommate gender filter', () => {
  const male = { ...base, gender: 'MALE' };
  const female = { ...base, gender: 'FEMALE' };

  it('same gender always passes, whatever the preference', () => {
    expect(genderConflict(male, { ...male })).toBeNull();
    expect(compatibility(female, { ...female }).excluded).toBeNull();
  });

  it('a "same gender only" preference on either side excludes a different-gender pair', () => {
    expect(compatibility(male, female).excluded).toMatch(/same gender/);
    expect(compatibility({ ...male, roommateGender: 'ANY' }, female).excluded).toMatch(/They only want/);
    expect(compatibility(male, { ...female, roommateGender: 'ANY' }).excluded).toMatch(/You only want/);
  });

  it('two students who both accept any gender can match, and gender does not change the score', () => {
    const r = compatibility({ ...male, roommateGender: 'ANY' }, { ...female, roommateGender: 'ANY' });
    expect(r.excluded).toBeNull();
    expect(r.score).toBe(100);
  });

  it('an unknown gender never passes a "same gender only" filter', () => {
    expect(genderConflict(male, { ...base, gender: null, roommateGender: 'ANY' })).toBeTruthy();
  });
});
