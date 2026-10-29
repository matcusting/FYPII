import { useI18n } from '../../lib/i18n'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { api, messageOf } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { Listing } from '../../lib/types'
import { money } from '../../lib/types'
import { favoriteIds, roomTypes, labelOf, formatDate } from './model'

export const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-[#203569] focus:ring-2 focus:ring-[#203569]/10 disabled:bg-gray-100'
export const primaryButton = 'inline-flex items-center justify-center rounded-lg bg-[#203569] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#1a2b56] focus:outline-none focus:ring-2 focus:ring-[#203569] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
export const secondaryButton = 'inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#203569] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: string; required?: boolean }) {
  return <label className="block space-y-1.5 text-[13px] font-bold text-[#374151]">
    <span>{label}{required && <span className="ml-1 text-rose-700" aria-hidden="true">*</span>}</span>
    {children}
    {hint && <span className="block text-xs font-normal text-gray-500">{hint}</span>}
  </label>
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) {
  const color = tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-900' : tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-[#c7d8ff] bg-[#edf4ff] text-[#203569]'
  return <div className={`rounded-lg border px-4 py-3 text-sm ${color}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function QueryState({ loading, error, retry, empty, children }: { loading?: boolean; error?: unknown; retry?: () => void; empty?: boolean; children: ReactNode }) {
  const { t } = useI18n()
  if (loading) return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-500" role="status">{t('Loading listings...')}</div>
  if (error) return <div className="space-y-4 rounded-xl border border-rose-200 bg-rose-50 p-8 text-center" role="alert"><p className="text-rose-900">{t(messageOf(error))}</p>{retry && <button type="button" className={secondaryButton} onClick={retry}>{t('Retry')}</button>}</div>
  if (empty) return <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-gray-600"><div className="mb-3 text-4xl">🔍</div><h3 className="mb-1 font-bold text-gray-800">{t('No properties found')}</h3><p className="text-sm">{t('Try adjusting your filters to see more results.')}</p></div>
  return <>{children}</>
}

export function FavoriteButton({ listingId, compact = false }: { listingId: string; compact?: boolean }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const favorites = useQuery({ queryKey: ['favorites'], queryFn: () => api<unknown>('/favorites'), enabled: !!user })
  const saved = favoriteIds(favorites.data).has(String(listingId))
  const mutation = useMutation({
    mutationFn: () => api('/favorites', { method: saved ? 'DELETE' : 'POST', body: JSON.stringify({ listingId }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['favorites'] }) },
  })
  return <span className="inline-flex flex-col items-start gap-1">
    <button type="button" aria-label={saved ? t('Remove listing from favorites') : t('Save listing to favorites')} aria-pressed={saved} className={compact ? 'flex h-9 w-9 items-center justify-center rounded-full bg-white text-2xl text-[#e11d48] transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#203569] disabled:opacity-50' : secondaryButton} disabled={mutation.isPending || (!!user && (favorites.isPending || favorites.isError))} title={user && favorites.isError ? t('Favorite status is temporarily unavailable') : undefined} onClick={() => {
      if (!user) { navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`); return }
      mutation.mutate()
    }}>{compact ? (saved ? '♥' : '♡') : (saved ? t('♥ Saved') : t('♡ Save to Wishlist'))}</button>
    {mutation.isError && <span className="text-xs text-rose-700" role="alert">{messageOf(mutation.error)}</span>}
  </span>
}

export function ListingCard({ listing }: { listing: Listing & { availabilityStale?: boolean } }) {
  const { t } = useI18n()
  const photo = listing.photos?.[0]
  const secondTag = listing.furnished ? t('Fully Furnished') : listing.amenities?.[0] ? t(listing.amenities[0]) : labelOf(roomTypes, listing.roomType)
  return <article className="group relative flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 transition hover:border-[#203569] hover:shadow-md sm:min-h-[134px] sm:flex-row sm:gap-5">
    <div className="absolute right-3 top-3 z-10"><FavoriteButton listingId={String(listing.id)} compact /></div>
    <Link to={`/listings/${encodeURIComponent(String(listing.id))}`} aria-label={t('View listing: {title}', { title: listing.title })} className="block shrink-0 sm:w-[140px]">
      {photo?.url ? <img src={photo.url} alt={photo.alt || t('{title} property photo', { title: listing.title })} loading="lazy" className="h-[130px] w-full rounded-lg object-cover sm:h-[100px]" /> : <div className="flex h-[130px] w-full items-center justify-center rounded-lg bg-[#e2e8f0] text-sm font-bold text-gray-400 sm:h-[100px]">{t('Image')}</div>}
    </Link>
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      <h3 className="truncate pr-8 text-[1.1rem] font-bold text-[#203569] group-hover:text-blue-700"><Link to={`/listings/${encodeURIComponent(String(listing.id))}`} className="focus:outline-none focus:underline">{listing.title}</Link></h3>
      <p className="mt-1 truncate text-[13px] text-gray-500">{listing.owner?.name ? t('Landlord · {name}', { name: listing.owner.name }) : t('Landlord')}</p>
      {listing.distanceKm != null && <p className="mt-1 text-xs font-semibold text-[#203569]">{t('{distance} km to {campus}', { distance: listing.distanceKm.toFixed(1), campus: listing.campusName || t('campus') })}</p>}
      {listing.lastConfirmedAt && !listing.availabilityStale && <p className="mt-1 text-xs text-gray-500">{t('Owner confirmed availability on {date}', { date: formatDate(listing.lastConfirmedAt) })}</p>}
      {listing.availabilityStale && <p className="mt-2 w-fit rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">{t('Availability needs reconfirmation.')}</p>}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2 sm:flex-nowrap">
        <div className="flex min-w-0 flex-wrap gap-2 sm:flex-nowrap">{listing.deposit != null && <span className="whitespace-nowrap rounded border border-gray-200 bg-[#f8f9fa] px-2 py-1 text-[10px] font-bold text-gray-600">{t('Deposit:')} {money(listing.deposit, listing.currency)}</span>}{secondTag && <span className="max-w-[130px] truncate rounded border border-gray-200 bg-[#f8f9fa] px-2 py-1 text-[10px] font-bold text-gray-600">{secondTag}</span>}</div>
        <strong className="ml-auto shrink-0 whitespace-nowrap text-[1.05rem] text-[#16a34a]">{money(listing.rent, listing.currency)}<span className="text-sm font-medium text-gray-500">{t('/mo')}</span></strong>
      </div>
    </div>
  </article>
}
