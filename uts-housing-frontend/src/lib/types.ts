export interface User {
  id: string
  name?: string
  email: string
  roles: string[]
  emailVerified?: boolean
  studentVerified?: boolean
  verificationStatus?: string
}

export interface Listing {
  id: string
  title: string
  description?: string
  rent: number | string
  currency?: string
  deposit?: number | string
  approximateArea?: string
  address?: string | null
  showExactLocation?: boolean
  availableFrom?: string
  lastConfirmedAt?: string
  propertyType?: string
  roomType?: string
  furnished?: boolean
  amenities?: string[]
  photos?: Array<{ id?: string; url: string; alt?: string }>
  status?: string
  campusId?: string
  campusName?: string
  distanceKm?: number | null
  ownerId?: string
  owner?: { id?: string; name?: string }
  rating?: number
  reviewCount?: number
  landlordRating?: number | null
  landlordReviewCount?: number
}

export interface PageData<T> {
  items: T[]
  total?: number
  page?: number
  pages?: number
  nextCursor?: string | null
}

export function money(value: number | string | undefined, currency = 'MYR') {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}
