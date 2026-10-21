import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, itemsOf } from '../../lib/api'
import { EmptyNotice, ErrorNotice, LoadingNotice } from './shared'
import { formatDate, labelForStatus } from './format'

interface Review {
  id: string
  listingId?: string
  listing?: { id?: string; title?: string }
  rating: number
  body?: string
  moderationStatus?: string
  status?: string
  createdAt?: string
  updatedAt?: string
  ownerResponse?: string
}

export function ReviewsMinePage() {
  // The route is required by the screen plan; the API table omits its GET endpoint.
  const reviews = useQuery({ queryKey: ['reviews-mine'], queryFn: () => api<unknown>('/reviews/mine') })
  const ownReviews = itemsOf<Review>(reviews.data)

  return <div className="min-h-screen bg-[#f8f9fa] px-4 pb-20 pt-8 text-[#1f2937] sm:px-6">
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 pb-4"><div><h1 className="text-[1.4rem] font-bold">My Reviews</h1><p className="mt-1 text-sm text-gray-500">Review your submitted ratings and moderation status.</p></div><Link to="/listings" className="text-sm font-bold text-[#203569] hover:underline">Browse Housing →</Link></div>
      {reviews.isPending ? <LoadingNotice /> : reviews.isError ? <ErrorNotice error={reviews.error} onRetry={() => void reviews.refetch()} /> : ownReviews.length ? <ul className="space-y-5">
        {ownReviews.map(review => {
          const listingId = review.listingId || review.listing?.id
          const rating = Number(review.rating)
          return <li key={review.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4"><span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-lg font-bold text-blue-600">★</span><div><h2 className="text-[15px] font-bold">{listingId ? <Link className="hover:text-[#203569] hover:underline" to={`/listings/${encodeURIComponent(listingId)}`}>{review.listing?.title || 'View Property'}</Link> : review.listing?.title || 'Property Review'}</h2><p className="mt-0.5 text-xs font-medium text-gray-500">Submitted {formatDate(review.createdAt)} · {labelForStatus(review.moderationStatus || review.status)}</p></div></div>
              <p className="text-lg tracking-widest text-[#eab308]" aria-label={`Rating ${Number.isFinite(rating) ? rating : 'unknown'} out of 5`}>
                {Number.isFinite(rating) && rating >= 1 && rating <= 5 ? <>{'★'.repeat(Math.round(rating))}<span className="text-gray-300">{'★'.repeat(5 - Math.round(rating))}</span></> : '—'}
              </p>
            </div>
            {review.body && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-600">{review.body}</p>}
            {review.ownerResponse && <div className="mt-4 rounded-r-lg border-l-4 border-[#203569] bg-[#f8f9fa] p-3.5 text-xs text-gray-600"><strong className="mb-1 block text-[#203569]">Landlord response:</strong>{review.ownerResponse}</div>}
            {review.updatedAt && review.updatedAt !== review.createdAt && <p className="mt-3 text-xs text-gray-500">Updated {formatDate(review.updatedAt)}</p>}
          </li>
        })}
      </ul> : <EmptyNotice>You have not submitted any reviews yet. Verified students with an eligible rental experience can review a property.</EmptyNotice>}
    </div>
  </div>
}
