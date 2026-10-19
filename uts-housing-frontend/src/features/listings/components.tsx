import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { api, messageOf } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { Listing } from '../../lib/types'
import { money } from '../../lib/types'
import { favoriteIds, formatDate, labelOf, propertyTypes, roomTypes } from './model'

export const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100'
export const primaryButton = 'inline-flex items-center justify-center rounded-xl bg-indigo-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
export const secondaryButton = 'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: string; required?: boolean }) {
  return <label className="block space-y-1.5 text-sm font-medium text-slate-700">
    <span>{label}{required && <span className="ml-1 text-rose-700" aria-hidden="true">*</span>}</span>
    {children}
    {hint && <span className="block text-xs font-normal text-slate-500">{hint}</span>}
  </label>
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) {
  const color = tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-900' : tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-indigo-200 bg-indigo-50 text-indigo-900'
  return <div className={`rounded-xl border px-4 py-3 text-sm ${color}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function QueryState({ loading, error, retry, empty, children }: { loading?: boolean; error?: unknown; retry?: () => void; empty?: boolean; children: ReactNode }) {
  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500" role="status">正在加载房源…</div>
  if (error) return <div className="space-y-4 rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center" role="alert"><p className="text-rose-900">{messageOf(error)}</p>{retry && <button type="button" className={secondaryButton} onClick={retry}>重试</button>}</div>
  if (empty) return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-600">目前没有符合条件的房源。</div>
  return <>{children}</>
}

export function FavoriteButton({ listingId, compact = false }: { listingId: string; compact?: boolean }) {
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
    <button type="button" aria-label={saved ? '取消收藏房源' : '收藏房源'} aria-pressed={saved} className={compact ? 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50' : secondaryButton} disabled={mutation.isPending || (!!user && (favorites.isPending || favorites.isError))} title={user && favorites.isError ? '暂时无法读取收藏状态' : undefined} onClick={() => {
      if (!user) { navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`); return }
      mutation.mutate()
    }}>{saved ? '♥ 已收藏' : '♡ 收藏'}</button>
    {mutation.isError && <span className="text-xs text-rose-700" role="alert">{messageOf(mutation.error)}</span>}
  </span>
}

export function ListingCard({ listing }: { listing: Listing }) {
  const photo = listing.photos?.[0]
  return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-200 hover:shadow-md">
    <Link to={`/listings/${encodeURIComponent(String(listing.id))}`} aria-label={`查看房源：${listing.title}`} className="block">
      {photo?.url ? <img src={photo.url} alt={photo.alt || `${listing.title} 房源照片`} loading="lazy" className="h-48 w-full object-cover" /> : <div className="flex h-48 items-center justify-center bg-slate-100 text-sm text-slate-500">暂无照片</div>}
    </Link>
    <div className="space-y-3 p-5">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-indigo-700">{labelOf(roomTypes, listing.roomType)} · {labelOf(propertyTypes, listing.propertyType)}</p><h3 className="mt-1 line-clamp-2 text-lg font-semibold text-slate-900"><Link to={`/listings/${encodeURIComponent(String(listing.id))}`} className="hover:text-indigo-700 focus:outline-none focus:underline">{listing.title}</Link></h3></div><FavoriteButton listingId={String(listing.id)} compact /></div>
      <p className="text-sm text-slate-600">{listing.approximateArea || '区域未提供'}{listing.campusName ? ` · ${listing.campusName}` : ''}</p>
      {typeof listing.distanceKm === 'number' && <p className="text-xs text-slate-500">距离校区约 {listing.distanceKm.toFixed(1)} 公里（直线距离）</p>}
      <div className="flex flex-wrap items-end justify-between gap-2 border-t border-slate-100 pt-3"><div><strong className="text-xl text-indigo-800">{money(listing.rent, listing.currency)}</strong><span className="text-sm text-slate-500"> / 月</span></div><span className="text-xs text-slate-500">{listing.availableFrom ? `${formatDate(listing.availableFrom)} 起可租` : '入住日期请询问房东'}</span></div>
    </div>
  </article>
}
