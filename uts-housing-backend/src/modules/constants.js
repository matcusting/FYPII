export const ROOM_TYPES = ['Single Room', 'Master Room', 'Shared Room', 'Whole Studio', 'Whole Apartment'];

export const GENDERS = ['MALE', 'FEMALE'];
export const GENDER_LABELS = { MALE: 'Male', FEMALE: 'Female' };
export const GENDER_RESTRICTIONS = ['ANY', 'MALE_ONLY', 'FEMALE_ONLY'];
export const GENDER_RESTRICTION_LABELS = { ANY: 'All genders welcome', MALE_ONLY: 'Male tenants only', FEMALE_ONLY: 'Female tenants only' };

/** True when a listing's gender restriction allows a tenant of this gender. */
export function genderAllowed(restriction, gender) {
  if (!restriction || restriction === 'ANY') return true;
  return (restriction === 'MALE_ONLY' && gender === 'MALE') || (restriction === 'FEMALE_ONLY' && gender === 'FEMALE');
}

export const REPORT_REASONS = [
  'Scam or fraudulent listing',
  'Listing no longer available',
  'Inaccurate information',
  'Harassment or abusive language',
  'Fake or misleading review',
  'Shares personal data',
  'Spam',
  'Other',
];
