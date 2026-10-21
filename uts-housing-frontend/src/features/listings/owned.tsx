import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, messageOf, query } from '../../lib/api'
import type { Listing } from '../../lib/types'
import { money } from '../../lib/types'
import { ListingCard, Notice, QueryState, secondaryButton } from './components'
import { formatDate, getList, type ListingDetails, type Review } from './model'

const statusLabels: Record<string, string> = { DRAFT: 'Draft', PENDING_REVIEW: 'In Review', PUBLISHED: 'Active', REJECTED: 'Changes Needed', PAUSED: 'Paused', RENTED: 'Rented', ARCHIVED: 'Archived' }
const smallButton = 'rounded border border-gray-300 bg-white px-4 py-1.5 text-xs font-bold text-[#334155] transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#203569] disabled:opacity-50'

export function FavoritesPage() {
  const favorites = useQuery({ queryKey: ['favorites'], queryFn: () => getList<Listing | { listing: Listing }>('/favorites') })
  const records = (favorites.data?.items || []).map(item => 'listing' in item ? item.listing : item).filter(item => !!item?.id)
  return <div className="mx-auto max-w-[1000px] px-4 py-9 sm:px-0">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 pb-5"><div><h1 className="text-[1.4rem] font-bold text-[#0f172a]">Saved Properties</h1><p className="mt-1 text-sm text-gray-500">Your saved homes, all in one place.</p></div><Link className={secondaryButton} to="/listings">Browse Properties</Link></div>
    <QueryState loading={favorites.isPending} error={favorites.error} retry={() => { void favorites.refetch() }} empty={!records.length}><div className="space-y-4">{records.map(item => <ListingCard key={item.id} listing={item} />)}</div></QueryState>
  </div>
}

export function MyListingsPage() {
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<{ id: string; type: 'rented' | 'archive' } | null>(null)
  const list = useQuery({ queryKey: ['my-listings', page], queryFn: () => getList<ListingDetails>(`/listings${query({ mine: true, page, limit: 20 })}`) })
  const action = useMutation({ mutationFn: ({ id, type }: { id: string; type: 'submit' | 'availability' | 'archive' | 'pause' | 'resume' | 'rented' }) => {
    const path = `/listings/${encodeURIComponent(id)}`
    if (type === 'archive') return api(path, { method: 'DELETE' })
    if (type === 'pause' || type === 'resume' || type === 'rented') {
      const status = type === 'pause' ? 'PAUSED' : type === 'resume' ? 'PUBLISHED' : 'RENTED'
      return api(path, { method: 'PATCH', body: JSON.stringify({ status }) })
    }
    return api(`${path}/${type}`, { method: 'POST' })
  }, onSuccess: async () => { setActionError(null); setConfirmation(null); await Promise.all([client.invalidateQueries({ queryKey: ['my-listings'] }), client.invalidateQueries({ queryKey: ['listings'] })]) }, onError: error => { setActionError(messageOf(error)) } })
  const items = list.data?.items || []
  const hasNext = list.data?.pages ? page < list.data.pages : items.length >= 20
  return <div className="p-5 sm:p-10">
    <div className="mb-8 flex max-w-4xl flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4"><h1 className="text-[1.4rem] font-bold text-[#0f172a]">Manage Properties</h1><Link to="/listings/new" className="rounded-lg bg-[#203569] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#1a2b56]">+ Add New Property</Link></div>
    <div className="max-w-4xl space-y-4">
      {actionError && <Notice tone="error">{actionError}</Notice>}{action.isSuccess && <Notice tone="success">Changes saved.</Notice>}
      <QueryState loading={list.isPending} error={list.error} retry={() => { void list.refetch() }} empty={!items.length && page === 1}>
        <div className="space-y-5">{items.map(item => <article key={item.id} className={`flex flex-col justify-between gap-5 rounded-xl border p-5 transition sm:flex-row ${item.status === 'PUBLISHED' ? 'border-gray-200 bg-white shadow-sm' : 'border-gray-100 bg-[#f8f9fa]'}`}>
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:gap-6">
            <div className="h-[110px] w-[140px] shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-[#cbd5e1]">{item.photos?.[0]?.url ? <img src={item.photos[0].url} alt={item.photos[0].alt || `${item.title} photo`} className="h-full w-full object-cover" /> : <div className="flex h-full w-full flex-col items-center justify-center text-sm font-bold text-[#475569]">Image<span className="mt-1 text-[10px] font-normal">{item.roomType || 'Property'}</span></div>}</div>
            <div className="min-w-0"><h2 className={`mb-1 text-[1.15rem] font-bold ${item.status === 'PUBLISHED' ? 'text-[#1e3a8a]' : 'text-gray-600'}`}>{item.title}</h2>
              <p className="mb-2 text-[13px] text-[#64748b]">{money(item.rent, item.currency)}/mo · Deposit: {money(item.deposit, item.currency)}{typeof item.distanceKm === 'number' ? ` · ${item.distanceKm.toFixed(1)} km to UTS` : ''}</p>
              <div className="mb-4 flex flex-wrap gap-1.5">{(item.amenities || []).map(amenity => <span key={amenity} className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">{amenity}</span>)}{item.furnished && <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">Furnished</span>}</div>
              {item.availabilityStale && <div className="mb-3"><Notice tone="error">Availability needs reconfirmation.</Notice></div>}{item.rejectionReason && <div className="mb-3"><Notice tone="error">Review feedback: {item.rejectionReason}</Notice></div>}
              <div className="flex flex-wrap gap-2"><Link className={smallButton} to={`/listings/${encodeURIComponent(item.id)}/edit`}>Edit Details</Link>{item.status === 'PUBLISHED' && <Link className={smallButton} to={`/listings/${encodeURIComponent(item.id)}`}>View Listing</Link>}
                {['DRAFT', 'REJECTED', 'RENTED'].includes(item.status || '') && <button type="button" className={smallButton} disabled={action.isPending || !item.photos?.length} title={!item.photos?.length ? 'Upload at least one photo before submitting' : undefined} onClick={() => action.mutate({ id: item.id, type: 'submit' })}>Submit for Review</button>}
                {['PUBLISHED', 'PAUSED'].includes(item.status || '') && <button type="button" className={smallButton} disabled={action.isPending} onClick={() => action.mutate({ id: item.id, type: 'availability' })}>Confirm Available</button>}
                {item.status === 'PUBLISHED' && <><button type="button" className={smallButton} disabled={action.isPending} onClick={() => action.mutate({ id: item.id, type: 'pause' })}>Pause Listing</button><button type="button" className={smallButton} disabled={action.isPending} onClick={() => setConfirmation({ id: item.id, type: 'rented' })}>Mark as Rented</button></>}
                {item.status === 'PAUSED' && <button type="button" className={smallButton} disabled={action.isPending} onClick={() => action.mutate({ id: item.id, type: 'resume' })}>Re-list Property</button>}
                {item.status !== 'ARCHIVED' && <button type="button" className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50" disabled={action.isPending} onClick={() => setConfirmation({ id: item.id, type: 'archive' })}>Delete</button>}
              </div>
              {confirmation?.id === item.id && <div role="group" aria-labelledby={`confirm-action-${item.id}`} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-gray-800">
                <p id={`confirm-action-${item.id}`} className="font-semibold">{confirmation.type === 'rented' ? 'Mark this property as rented? It will no longer appear in search.' : 'Archive this property? It will no longer appear in search.'}</p>
                <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={smallButton} disabled={action.isPending} onClick={() => setConfirmation(null)}>Cancel</button><button type="button" className="rounded border border-red-700 bg-red-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50" disabled={action.isPending} onClick={() => action.mutate(confirmation)}>{action.isPending ? 'Saving…' : confirmation.type === 'rented' ? 'Confirm Rented' : 'Archive Property'}</button></div>
              </div>}
              {item.lastConfirmedAt && <p className="mt-3 text-[11px] text-gray-400">Availability confirmed {formatDate(item.lastConfirmedAt)}</p>}</div>
          </div><span className={`inline-flex h-fit shrink-0 items-center gap-2 self-start rounded px-3 py-1.5 text-xs font-bold ${item.status === 'PUBLISHED' ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-gray-200 text-gray-500'}`}>{item.status === 'PUBLISHED' && <span className="h-2 w-2 rounded-full bg-[#15803d]" />}{statusLabels[item.status || ''] || item.status || 'Unknown'}</span>
        </article>)}{!items.length && page > 1 && <Notice>No properties on this page. Go back to the previous page.</Notice>}</div>
        <nav aria-label="My properties pagination" className="mt-6 flex items-center justify-center gap-3"><button className={secondaryButton} type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="text-sm text-gray-600">Page {page}</span><button className={secondaryButton} type="button" disabled={!hasNext} onClick={() => setPage(page + 1)}>Next</button></nav>
      </QueryState>
    </div>
  </div>
}

export function LandlordReviewsPage() {
  const listings = useQuery({ queryKey: ['landlord-review-listings'], queryFn: async () => {
    const all: ListingDetails[] = []
    for (let page = 1; page <= 100; page++) {
      const result = await getList<ListingDetails>(`/listings${query({ mine: true, page, limit: 100 })}`)
      all.push(...result.items)
      if (result.pages ? page >= result.pages : result.items.length < 100) break
    }
    return all
  } })
  const reviewQueries = useQueries({ queries: (listings.data || []).map(item => ({ queryKey: ['landlord-listing-reviews', item.id], queryFn: async () => {
    const all: Review[] = []
    for (let page = 1; page <= 100; page++) {
      const result = await getList<Review>(`/listings/${encodeURIComponent(item.id)}/reviews${query({ page, limit: 100 })}`)
      all.push(...result.items)
      if (result.pages ? page >= result.pages : result.items.length < 100) break
    }
    return all
  } })) })
  const loading = listings.isPending || reviewQueries.some(result => result.isPending)
  const error = listings.error || reviewQueries.find(result => result.error)?.error
  const entries = (listings.data || []).flatMap((listing, index) => (reviewQueries[index]?.data || []).map(review => ({ listing, review }))).sort((a, b) => (b.review.createdAt || '').localeCompare(a.review.createdAt || ''))
  const average = entries.length ? entries.reduce((sum, entry) => sum + Number(entry.review.rating || 0), 0) / entries.length : 0
  return <div className="p-5 sm:p-10"><div className="mb-8 flex max-w-4xl flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4"><div><h1 className="text-[1.4rem] font-bold text-[#0f172a]">Student Reviews</h1><p className="mt-1 text-xs text-gray-500">Approved reviews of your properties</p></div>{entries.length > 0 && <div className="text-right"><strong className="text-xl text-[#0f172a]">{average.toFixed(1)} <span className="text-amber-500">★</span></strong><p className="text-xs text-gray-500">{entries.length} reviews</p></div>}</div>
    <div className="max-w-4xl"><QueryState loading={loading} error={error} retry={() => { void listings.refetch(); reviewQueries.forEach(result => { void result.refetch() }) }}><div className="space-y-5">{entries.length ? entries.map(({ listing, review }) => <article key={`${listing.id}-${review.id}`} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#edf4ff] font-bold text-[#203569]">{(review.author?.name || review.authorName || 'S').charAt(0).toUpperCase()}</div><div><strong className="text-sm text-[#0f172a]">{review.author?.name || review.authorName || 'Student'}</strong><p className="text-xs text-gray-500">{listing.title}</p></div></div><time className="text-xs text-gray-400">{formatDate(review.createdAt)}</time></div><p aria-label={`${review.rating} out of 5 stars`} className="mt-3 text-amber-500">{'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}{'☆'.repeat(5 - Math.max(0, Math.min(5, Number(review.rating) || 0)))}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{review.body}</p></article>) : <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">No approved reviews yet.</div>}</div></QueryState></div>
  </div>
}
