export const lifestyleFields = [
  { key: 'smoking', label: '吸烟习惯', options: [['', '暂不填写'], ['NEVER', '不吸烟'], ['OCCASIONAL', '偶尔吸烟'], ['REGULAR', '经常吸烟'], ['NO_PREFERENCE', '不介意']] },
  { key: 'studySchedule', label: '学习时间', options: [['', '暂不填写'], ['MORNING', '上午'], ['DAY', '白天'], ['EVENING', '晚上'], ['FLEXIBLE', '灵活']] },
  { key: 'sleepSchedule', label: '作息时间', options: [['', '暂不填写'], ['EARLY', '早睡早起'], ['LATE', '晚睡晚起'], ['FLEXIBLE', '灵活']] },
  { key: 'cleanliness', label: '整洁程度', options: [['', '暂不填写'], ['RELAXED', '随意'], ['MODERATE', '适中'], ['HIGH', '很讲究']] },
  { key: 'noise', label: '噪音接受度', options: [['', '暂不填写'], ['QUIET', '偏好安静'], ['MODERATE', '适中'], ['LIVELY', '可以热闹']] },
  { key: 'guests', label: '访客频率', options: [['', '暂不填写'], ['RARE', '很少'], ['SOMETIMES', '偶尔'], ['OFTEN', '经常']] },
  { key: 'pets', label: '宠物偏好', options: [['', '暂不填写'], ['NO_PETS', '无宠物'], ['PETS_OK', '可接受宠物'], ['HAS_PETS', '有宠物']] },
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
    id, displayName: string(person.displayName ?? person.name) || '已验证学生',
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
