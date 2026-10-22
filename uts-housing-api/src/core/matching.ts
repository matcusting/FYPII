/** Transparent, deterministic roommate matching. Missing answers never count as a mismatch. */
export const dimensions = ['smoking', 'studySchedule', 'sleepSchedule', 'cleanliness', 'noise', 'guests', 'pets'] as const
export type Dimension = typeof dimensions[number]
export type Answers = Partial<Record<Dimension, string | null>>

export interface MatchingProfile {
  lifestyle?: unknown
  roommatePreferences?: unknown
  importanceWeights?: unknown
  visibility?: unknown
  budgetMin?: number | string | { toString(): string } | null
  budgetMax?: number | string | { toString(): string } | null
  moveInDate?: Date | string | null
  preferredLocation?: string | null
  smokeFreeOnly?: boolean
  petFreeOnly?: boolean
}

export interface MatchResult {
  eligible: boolean
  score: number | null
  factors: string[]
  explanation: string
}

const baseWeights: Record<Dimension, number> = {
  smoking: 25, studySchedule: 10, sleepSchedule: 10, cleanliness: 20,
  noise: 15, guests: 10, pets: 10,
}

const dimensionLabels: Record<Dimension, string> = {
  smoking: 'smoking preference', studySchedule: 'study schedule', sleepSchedule: 'sleep schedule',
  cleanliness: 'cleanliness', noise: 'noise preference', guests: 'guest preference', pets: 'pet preference',
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function answer(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function numeric(value: MatchingProfile['budgetMin']): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function timestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function locationTerms(value: string | null | undefined): Set<string> {
  const ignored = new Set(['near', 'the', 'a', 'at', 'area', 'campus', 'city', 'centre', 'center', 'jalan', 'road', 'student'])
  return new Set((value || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 2 && !ignored.has(term)))
}

function rankDistance(key: Dimension, left: string, right: string): number {
  const levels: Partial<Record<Dimension, string[]>> = {
    cleanliness: ['RELAXED', 'MODERATE', 'HIGH'],
    noise: ['QUIET', 'MODERATE', 'LIVELY'],
    guests: ['RARE', 'SOMETIMES', 'OFTEN'],
  }
  const choices = levels[key]
  if (!choices) return -1
  const a = choices.indexOf(left)
  const b = choices.indexOf(right)
  return a < 0 || b < 0 ? -1 : Math.abs(a - b)
}

export function similarity(key: Dimension, expected: string, actual: string): number {
  if (expected === actual) return 1
  if (expected === 'NO_PREFERENCE' || actual === 'NO_PREFERENCE') return 0.8
  if ((key === 'studySchedule' || key === 'sleepSchedule') && (expected === 'FLEXIBLE' || actual === 'FLEXIBLE')) return 0.75
  if (key === 'smoking') {
    const pair = new Set([expected, actual])
    if (pair.has('NEVER') && pair.has('REGULAR')) return 0
    if (pair.has('NEVER') && pair.has('OCCASIONAL')) return 0.4
    if (pair.has('OCCASIONAL') && pair.has('REGULAR')) return 0.5
  }
  if (key === 'pets') {
    const pair = new Set([expected, actual])
    if (pair.has('NO_PETS') && pair.has('HAS_PETS')) return 0
    if (pair.has('PETS_OK') && pair.has('HAS_PETS')) return 1
    return 0.6
  }
  const distance = rankDistance(key, expected, actual)
  if (distance >= 0) return distance === 1 ? 0.5 : 0
  if (key === 'studySchedule' && new Set([expected, actual]).has('DAY')) return 0.5
  return 0
}

function disqualifyingConflict(first: MatchingProfile, second: MatchingProfile): boolean {
  const a = object(first.lifestyle)
  const b = object(second.lifestyle)
  if (first.smokeFreeOnly && answer(b.smoking) !== 'NEVER') return true
  if (second.smokeFreeOnly && answer(a.smoking) !== 'NEVER') return true
  if (first.petFreeOnly && answer(b.pets) !== 'NO_PETS') return true
  if (second.petFreeOnly && answer(a.pets) !== 'NO_PETS') return true
  return false
}

export function evaluateMatch(first: MatchingProfile, second: MatchingProfile, options: { moveInToleranceDays?: number } = {}): MatchResult {
  const ineligible = (): MatchResult => ({ eligible: false, score: null, factors: [], explanation: 'This profile does not meet your required roommate conditions.' })
  if (disqualifyingConflict(first, second)) return ineligible()

  const firstMin = numeric(first.budgetMin)
  const firstMax = numeric(first.budgetMax)
  const secondMin = numeric(second.budgetMin)
  const secondMax = numeric(second.budgetMax)
  if (firstMin !== null && secondMax !== null && firstMin > secondMax) return ineligible()
  if (secondMin !== null && firstMax !== null && secondMin > firstMax) return ineligible()

  const firstMoveIn = timestamp(first.moveInDate)
  const secondMoveIn = timestamp(second.moveInDate)
  const tolerance = options.moveInToleranceDays ?? 45
  if (firstMoveIn !== null && secondMoveIn !== null && Math.abs(firstMoveIn - secondMoveIn) > tolerance * 86_400_000) return ineligible()

  const firstLocation = locationTerms(first.preferredLocation)
  const secondLocation = locationTerms(second.preferredLocation)
  if (firstLocation.size && secondLocation.size && ![...firstLocation].some(term => secondLocation.has(term))) return ineligible()

  const own = object(first.lifestyle)
  const wanted = object(first.roommatePreferences)
  const candidate = object(second.lifestyle)
  const candidateWanted = object(second.roommatePreferences)
  const weights = object(first.importanceWeights)
  const scores: Array<{ key: Dimension; similarity: number; weight: number }> = []

  for (const key of dimensions) {
    const directed: number[] = []
    const firstExpected = answer(wanted[key]) || answer(own[key])
    const secondActual = answer(candidate[key])
    if (firstExpected && secondActual) directed.push(similarity(key, firstExpected, secondActual))
    const secondExpected = answer(candidateWanted[key]) || secondActual
    const firstActual = answer(own[key])
    if (secondExpected && firstActual) directed.push(similarity(key, secondExpected, firstActual))
    if (!directed.length) continue
    const importance = Number(weights[key])
    const weight = baseWeights[key] * (Number.isFinite(importance) ? Math.min(5, Math.max(1, importance)) : 1)
    scores.push({ key, similarity: directed.reduce((sum, value) => sum + value, 0) / directed.length, weight })
  }

  if (scores.length < 3) return { eligible: true, score: null, factors: [], explanation: 'There is not enough shared profile information to show a match percentage. Answer at least three lifestyle questions.' }

  const weightTotal = scores.reduce((sum, item) => sum + item.weight, 0)
  const score = Math.round(100 * scores.reduce((sum, item) => sum + item.weight * item.similarity, 0) / weightTotal)
  const lifestylePublic = object(second.visibility).lifestyle === true
  const factors = lifestylePublic
    ? scores.filter(item => item.similarity >= 0.65).sort((a, b) => b.weight * b.similarity - a.weight * a.similarity).slice(0, 3).map(item => `You share a similar ${dimensionLabels[item.key]}`)
    : []
  if (firstLocation.size && secondLocation.size && object(second.visibility).preferredLocation === true) factors.push('Your preferred areas are similar')
  return { eligible: true, score, factors: factors.slice(0, 3), explanation: 'This score compares your stated preferences and answered habits. It is a guide, not a guarantee of compatibility.' }
}
