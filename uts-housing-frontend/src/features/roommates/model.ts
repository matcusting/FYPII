export const lifestyleFields = [
  { key: 'smoking', label: 'Smoking', options: [['', 'Prefer not to say'], ['NEVER', 'Never'], ['OCCASIONAL', 'Occasionally'], ['REGULAR', 'Regularly'], ['NO_PREFERENCE', 'No preference']] },
  { key: 'studySchedule', label: 'Study schedule', options: [['', 'Prefer not to say'], ['MORNING', 'Morning'], ['DAY', 'Daytime'], ['EVENING', 'Evening'], ['FLEXIBLE', 'Flexible']] },
  { key: 'sleepSchedule', label: 'Sleep schedule', options: [['', 'Prefer not to say'], ['EARLY', 'Early nights'], ['LATE', 'Late nights'], ['FLEXIBLE', 'Flexible']] },
  { key: 'cleanliness', label: 'Cleanliness', options: [['', 'Prefer not to say'], ['RELAXED', 'Relaxed'], ['MODERATE', 'Moderate'], ['HIGH', 'Very tidy']] },
  { key: 'noise', label: 'Noise preference', options: [['', 'Prefer not to say'], ['QUIET', 'Quiet'], ['MODERATE', 'Moderate'], ['LIVELY', 'Lively is fine']] },
  { key: 'guests', label: 'Guests', options: [['', 'Prefer not to say'], ['RARE', 'Rarely'], ['SOMETIMES', 'Sometimes'], ['OFTEN', 'Often']] },
  { key: 'pets', label: 'Pets', options: [['', 'Prefer not to say'], ['NO_PETS', 'No pets'], ['PETS_OK', 'Pets are welcome'], ['HAS_PETS', 'I have pets']] },
] as const

export type LifestyleKey = typeof lifestyleFields[number]['key']
export type LifestyleAnswers = Record<LifestyleKey, string>
export type PrivacyField = 'university' | 'bio' | 'preferredLocation' | 'budget' | 'moveInDate' | 'lifestyle'

export interface RoommateProfile {
  displayName: string
  university: string
  bio: string
  preferredLocation: string
  budgetMin: string
  budgetMax: string
  moveInDate: string
  discoverable: boolean
  lifestyle: LifestyleAnswers
  roommatePreferences: LifestyleAnswers
  importanceWeights: Record<LifestyleKey, number>
  visibility: Record<PrivacyField, boolean>
  smokeFreeOnly: boolean
  petFreeOnly: boolean
}

export interface Match {
  id: string
  displayName: string
  university?: string
  bio?: string
  preferredLocation?: string
  budgetMin?: number
  budgetMax?: number
  moveInDate?: string
  score?: number
  explanation?: string
  factors: string[]
  requestStatus?: string
}

const blankAnswers = (): LifestyleAnswers => ({
  smoking: '', studySchedule: '', sleepSchedule: '', cleanliness: '', noise: '', guests: '', pets: '',
})

export function blankProfile(): RoommateProfile {
  return {
    displayName: '', university: '', bio: '', preferredLocation: '', budgetMin: '', budgetMax: '', moveInDate: '',
    discoverable: false, lifestyle: blankAnswers(), roommatePreferences: blankAnswers(),
    importanceWeights: { smoking: 1, studySchedule: 1, sleepSchedule: 1, cleanliness: 1, noise: 1, guests: 1, pets: 1 },
    visibility: { university: false, bio: false, preferredLocation: false, budget: false, moveInDate: false, lifestyle: false },
    smokeFreeOnly: false, petFreeOnly: false,
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numericString(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : string(value)
}

function answers(value: unknown): LifestyleAnswers {
  const source = record(value)
  const next = blankAnswers()
  for (const { key } of lifestyleFields) next[key] = string(source[key])
  return next
}

export function profileOf(raw: unknown): RoommateProfile {
  const data = record(raw)
  const visibility = record(data.visibility)
  const weights = record(data.importanceWeights)
  const initial = blankProfile()
  return {
    displayName: string(data.displayName), university: string(data.university), bio: string(data.bio),
    preferredLocation: string(data.preferredLocation), budgetMin: numericString(data.budgetMin),
    budgetMax: numericString(data.budgetMax), moveInDate: string(data.moveInDate)?.slice(0, 10),
    discoverable: data.discoverable === true,
    lifestyle: answers(data.lifestyle), roommatePreferences: answers(data.roommatePreferences),
    importanceWeights: Object.fromEntries(lifestyleFields.map(({ key }) => [key, Number(weights[key]) || 1])) as Record<LifestyleKey, number>,
    visibility: Object.fromEntries(Object.keys(initial.visibility).map(key => [key, visibility[key] === true])) as Record<PrivacyField, boolean>,
    smokeFreeOnly: data.smokeFreeOnly === true, petFreeOnly: data.petFreeOnly === true,
  }
}

export function profilePayload(profile: RoommateProfile) {
  return {
    ...profile,
    budgetMin: profile.budgetMin === '' ? null : Number(profile.budgetMin),
    budgetMax: profile.budgetMax === '' ? null : Number(profile.budgetMax),
    moveInDate: profile.moveInDate || null,
    lifestyle: Object.fromEntries(Object.entries(profile.lifestyle).map(([key, value]) => [key, value || null])),
    roommatePreferences: Object.fromEntries(Object.entries(profile.roommatePreferences).map(([key, value]) => [key, value || null])),
  }
}

export function matchOf(raw: unknown): Match | null {
  const source = record(raw)
  const publicProfile = record(source.publicProfile)
  const hasPublicProfile = source.publicProfile !== undefined
  const person = hasPublicProfile ? publicProfile : record(source.profile ?? source.student ?? source.user ?? source)
  const visibility = record(person.visibility ?? source.visibility)
  const canShow = (field: PrivacyField) => hasPublicProfile || visibility[field] === true
  const id = string(person.userId ?? person.id ?? source.userId ?? source.id)
  if (!id) return null
  const scoreValue = source.compatibilityScore ?? source.score
  const score = typeof scoreValue === 'number' && Number.isFinite(scoreValue) && scoreValue >= 0 && scoreValue <= 100
    ? Math.round(scoreValue) : undefined
  const rawFactors = source.topFactors ?? source.factors ?? source.highlights
  const factors = Array.isArray(rawFactors)
    ? rawFactors.flatMap(value => {
      if (typeof value === 'string') return [value]
      const item = record(value)
      const label = string(item.explanation ?? item.label ?? item.dimension)
      return label ? [label] : []
    }).slice(0, 5) : []
  const numberOrUndefined = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
  return {
    id, displayName: string(person.displayName ?? person.name) || 'Verified student',
    university: canShow('university') ? string(person.university) : '',
    bio: canShow('bio') ? string(person.bio) : '',
    preferredLocation: canShow('preferredLocation') ? string(person.preferredLocation ?? person.approximateArea) : '',
    budgetMin: canShow('budget') ? numberOrUndefined(person.budgetMin) : undefined,
    budgetMax: canShow('budget') ? numberOrUndefined(person.budgetMax) : undefined,
    moveInDate: canShow('moveInDate') ? string(person.moveInDate) : '', score,
    explanation: string(source.explanation), factors,
    requestStatus: string(source.requestStatus),
  }
}
