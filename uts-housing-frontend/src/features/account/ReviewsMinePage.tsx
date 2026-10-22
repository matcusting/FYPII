import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, itemsOf, messageOf } from '../../lib/api'
import { EmptyNotice, ErrorNotice, LoadingNotice } from './shared'
import { formatDate, labelForStatus } from './format'

interface Review {
  id: string
  listingId?: string
  listing?: { id?: string; title?: string }
  rating: number
  body?: string
  experienceDescription?: string
  experienceProofStatus?: string
  revision?: number
  moderationStatus?: string
  status?: string
  createdAt?: string
  updatedAt?: string
  ownerResponse?: string
}
interface ReviewPage { items: Review[]; pages?: number }

export function ReviewsMinePage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<string | null>(null)
  const [rating, setRating] = useState('')
  const [body, setBody] = useState('')
  const [experienceDescription, setExperienceDescription] = useState('')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [validation, setValidation] = useState('')
  const [notice, setNotice] = useState('')
  const reviews = useQuery({ queryKey: ['reviews-mine', page], queryFn: () => api<ReviewPage>(`/reviews/mine?page=${page}&limit=10`) })
  const ownReviews = itemsOf<Review>(reviews.data)
  const pages = Math.max(1, reviews.data?.pages || 1)
  const update = useMutation({
    mutationFn: async ({ review, file, rating, body, description }: { review: Review; file: File; rating: number; body: string; description: string }) => {
      const signed = await api<{ uploadUrl: string; objectKey: string; headers?: Record<string, string> }>('/uploads/sign', {
        method: 'POST', body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, purpose: 'REVIEW_EVIDENCE' }),
      })
      if (!signed.uploadUrl || !signed.objectKey) throw new Error('The server did not provide a valid proof upload URL.')
      const uploaded = await fetch(signed.uploadUrl, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': file.type, ...signed.headers }, body: file })
      if (!uploaded.ok) throw new Error('Could not upload the private rental proof. Please try again.')
      return api(`/listings/${encodeURIComponent(review.listingId || review.listing?.id || '')}/reviews/${encodeURIComponent(review.id)}`, {
        method: 'PATCH', body: JSON.stringify({ rating, body, experienceDescription: description, experienceProofKey: signed.objectKey }),
      })
    },
    onSuccess: async () => {
      setEditing(null)
      setProofFile(null)
      setNotice('Your updated review was sent back for moderation.')
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['reviews-mine'] }), queryClient.invalidateQueries({ queryKey: ['listing-reviews'] })])
    },
  })

  function beginEdit(review: Review) {
    setEditing(review.id)
    setRating(String(review.rating))
    setBody(review.body || '')
    setExperienceDescription(review.experienceDescription || '')
    setProofFile(null)
    setValidation('')
    setNotice('')
    update.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>, review: Review) {
    event.preventDefault()
    const score = Number(rating)
    if (!Number.isInteger(score) || score < 1 || score > 5) { setValidation('Select a rating from 1 to 5.'); return }
    if (body.trim().length < 20 || body.trim().length > 2000) { setValidation('Write a review between 20 and 2,000 characters.'); return }
    if (experienceDescription.trim().length < 10 || experienceDescription.trim().length > 500) { setValidation('Describe your rental experience in 10 to 500 characters.'); return }
    if (!proofFile || !['application/pdf', 'image/jpeg', 'image/png'].includes(proofFile.type) || proofFile.size > 5_000_000) { setValidation('Attach a PDF, JPG or PNG proof file no larger than 5 MB.'); return }
    setValidation('')
    update.mutate({ review, file: proofFile, rating: score, body: body.trim(), description: experienceDescription.trim() })
  }

  return <div className="min-h-screen bg-[#f8f9fa] px-4 pb-20 pt-8 text-[#1f2937] sm:px-6">
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 pb-4"><div><h1 className="text-[1.4rem] font-bold">My Reviews</h1><p className="mt-1 text-sm text-gray-500">Review your submitted ratings and moderation status.</p></div><Link to="/listings" className="text-sm font-bold text-[#203569] hover:underline">Browse Housing →</Link></div>
      {notice && <p role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {reviews.isPending ? <LoadingNotice /> : reviews.isError ? <ErrorNotice error={reviews.error} onRetry={() => void reviews.refetch()} /> : ownReviews.length ? <ul className="space-y-5">
        {ownReviews.map(review => {
          const listingId = review.listingId || review.listing?.id
          const score = Number(review.rating)
          return <li key={review.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4"><span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-lg font-bold text-blue-600">★</span><div><h2 className="text-[15px] font-bold">{listingId ? <Link className="hover:text-[#203569] hover:underline" to={`/listings/${encodeURIComponent(listingId)}`}>{review.listing?.title || 'View Property'}</Link> : review.listing?.title || 'Property Review'}</h2><p className="mt-0.5 text-xs font-medium text-gray-500">Submitted {formatDate(review.createdAt)} · {labelForStatus(review.moderationStatus || review.status)}</p></div></div>
              <p className="text-lg tracking-widest text-[#eab308]" aria-label={`Rating ${Number.isFinite(score) ? score : 'unknown'} out of 5`}>{Number.isFinite(score) && score >= 1 && score <= 5 ? <>{'★'.repeat(Math.round(score))}<span className="text-gray-300">{'★'.repeat(5 - Math.round(score))}</span></> : '—'}</p>
            </div>
            {review.body && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-600">{review.body}</p>}
            {review.experienceProofStatus && <p className="mt-3 text-xs text-gray-500">Rental proof: {labelForStatus(review.experienceProofStatus)}{review.revision && review.revision > 1 ? ` · Revision ${review.revision}` : ''}</p>}
            {review.ownerResponse && <div className="mt-4 rounded-r-lg border-l-4 border-[#203569] bg-[#f8f9fa] p-3.5 text-xs text-gray-600"><strong className="mb-1 block text-[#203569]">Landlord response:</strong>{review.ownerResponse}</div>}
            {review.updatedAt && review.updatedAt !== review.createdAt && <p className="mt-3 text-xs text-gray-500">Updated {formatDate(review.updatedAt)}</p>}
            {listingId && (editing === review.id ? <form onSubmit={event => submit(event, review)} className="mt-5 space-y-3 border-t border-gray-100 pt-5" noValidate>
              <h3 className="text-sm font-bold text-[#203569]">Edit review</h3><p className="text-xs text-gray-600">Editing sends the review back for approval. Attach your rental proof again; it stays private.</p>
              <label className="block text-sm font-medium">Rating<select value={rating} onChange={event => setRating(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2.5"><option value="">Select rating</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></label>
              <label className="block text-sm font-medium">Your review<textarea value={body} onChange={event => setBody(event.target.value)} rows={4} maxLength={2000} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2.5" /></label>
              <label className="block text-sm font-medium">Rental experience<textarea value={experienceDescription} onChange={event => setExperienceDescription(event.target.value)} rows={3} maxLength={500} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2.5" /></label>
              <label className="block text-sm font-medium">Private proof (PDF, JPG or PNG, up to 5 MB)<input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={event => setProofFile(event.currentTarget.files?.[0] || null)} className="mt-1 block w-full text-sm" /></label>
              {validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}{update.isError && <p role="alert" className="text-sm text-red-700">{messageOf(update.error)}</p>}
              <div className="flex flex-wrap gap-3"><button type="submit" disabled={update.isPending} className="rounded-lg bg-[#203569] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{update.isPending ? 'Saving…' : 'Submit updated review'}</button><button type="button" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold" onClick={() => { setEditing(null); setValidation('') }}>Cancel</button></div>
            </form> : <button type="button" className="mt-4 text-sm font-semibold text-[#203569] underline" onClick={() => beginEdit(review)}>Edit review</button>)}
          </li>
        })}
      </ul> : <EmptyNotice>You have not submitted any reviews yet. Verified students with an eligible rental experience can review a property.</EmptyNotice>}
      {pages > 1 && <nav aria-label="My reviews pages" className="mt-5 flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1); setEditing(null) }} className="font-semibold text-[#203569] disabled:text-gray-400">Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => { setPage(value => value + 1); setEditing(null) }} className="font-semibold text-[#203569] disabled:text-gray-400">Next</button></nav>}
    </div>
  </div>
}
