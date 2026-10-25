import type { Listing, PageData } from '../../lib/types'
import { api, itemsOf } from '../../lib/api'
import { currentLocale, translate } from '../../lib/i18n'

export interface Campus { id: string; name: string; university?: string }
export interface Amenity { id: string; name: string; slug?: string }
export interface Review {
  id: string
  rating: number
  body: string
  ownerResponse?: string
  createdAt?: string
  author?: { name?: string }
  authorName?: string
}
export interface ListingPhoto { id?: string; url: string; alt?: string; objectKey?: string }
export interface ListingDetails extends Listing {
  houseRules?: string
  contactMethod?: string
  rejectionReason?: string
  amenityIds?: string[]
  photos?: ListingPhoto[]
  createdAt?: string
  updatedAt?: string
  availabilityStale?: boolean
}
export interface Paginated<T> extends PageData<T> { limit?: number }

export async function getList<T>(path: string): Promise<Paginated<T>> {
  const value = await api<Paginated<T> | T[]>(path)
  if (Array.isArray(value)) return { items: value }
  return { ...value, items: itemsOf<T>(value) }
}

export function parseFavorites(value: unknown): Listing[] {
  return itemsOf<Listing | { listing: Listing }>(value).map(item => {
    if (item && typeof item === 'object' && 'listing' in item) return item.listing
    return item as Listing
  }).filter(item => !!item?.id)
}

export function favoriteIds(value: unknown): Set<string> {
  return new Set(parseFavorites(value).map(item => String(item.id)))
}

export function formatDate(value?: string): string {
  if (!value) return translate('Not provided')
  const date = new Date(value)
  const locale = currentLocale() === 'zh-CN' ? 'zh-CN' : currentLocale() === 'ms' ? 'ms-MY' : 'en-MY'
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale)
}

export const propertyTypes = [
  ['APARTMENT', 'Apartment'], ['HOUSE', 'House'], ['STUDIO', 'Studio'], ['OTHER', 'Other'],
] as const

export const roomTypes = [
  ['SINGLE', 'Single Room'], ['SHARED', 'Shared Room'], ['MASTER', 'Master Room'], ['ENTIRE', 'Whole Apartment'],
] as const

export const statusNames: Record<string, string> = {
  DRAFT: 'Draft', PENDING_REVIEW: 'In review', PUBLISHED: 'Published', REJECTED: 'Rejected',
  PAUSED: 'Paused', RENTED: 'Rented', ARCHIVED: 'Archived',
}

export function labelOf(values: readonly (readonly [string, string])[], value?: string): string {
  return translate(values.find(([key]) => key === value)?.[1] || value || 'Not provided')
}
