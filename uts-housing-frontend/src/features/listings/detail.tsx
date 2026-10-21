import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { money } from '../../lib/types'
import { FavoriteButton, Field, inputClass, Notice, primaryButton, QueryState, secondaryButton } from './components'
import { formatDate, getList, labelOf, propertyTypes, roomTypes, type ListingDetails, type Review } from './model'

function Reviews({ listingId }: { listingId: string }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [validationError, setValidationError] = useState('')
  const reviews = useQuery({ queryKey: ['listing-reviews', listingId], queryFn: () => getList<Review>(`/listings/${encodeURIComponent(listingId)}/reviews`) })
  const mutation = useMutation({ mutationFn: (payload: { rating: number; body: string; experienceDescription: string }) => api(`/listings/${encodeURIComponent(listingId)}/reviews`, { method: 'POST', body: JSON.stringify(payload) }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['listing-reviews', listingId] }) } })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const rating = Number(data.get('rating'))
    const body = String(data.get('body') || '').trim()
    const experienceDescription = String(data.get('experienceDescription') || '').trim()
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) { setValidationError('Select a rating from 1 to 5.'); return }
    if (body.length < 20 || body.length > 2000) { setValidationError('Write a review between 20 and 2,000 characters.'); return }
    if (experienceDescription.length < 10 || experienceDescription.length > 500) { setValidationError('Describe your rental experience in 10 to 500 characters.'); return }
    setValidationError('')
    mutation.mutate({ rating, body, experienceDescription }, { onSuccess: () => form.reset() })
  }
  return <section className="space-y-5" aria-labelledby="reviews-heading">
    <div><h2 id="reviews-heading" className="text-lg font-bold text-[#0f172a]">Student Reviews</h2><p className="mt-1 text-sm text-gray-600">Only approved reviews are shown. Students must verify their rental experience before posting.</p></div>
    {reviews.isPending ? <p role="status" className="text-gray-500">Loading reviews…</p> : reviews.isError ? <Notice tone="error">{messageOf(reviews.error)}</Notice> : reviews.data?.items.length ? <div className="space-y-3">{reviews.data.items.map(review => <article key={review.id} className="rounded-xl border border-gray-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{review.author?.name || review.authorName || 'Student'}</strong><span className="text-sm text-gray-500">{formatDate(review.createdAt)}</span></div><p aria-label={`${review.rating} out of 5 stars`} className="mt-1 text-amber-700">{'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}{'☆'.repeat(5 - Math.max(0, Math.min(5, Number(review.rating) || 0)))}</p><p className="mt-2 whitespace-pre-wrap text-gray-700">{review.body}</p></article>)}</div> : <Notice>No approved reviews yet.</Notice>}
    {!user ? <p className="text-sm text-gray-600"><Link to={`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`} className="font-semibold text-[#203569] underline">Log in</Link> to request a review.</p> : !hasRole(user, 'STUDENT') || !user.studentVerified ? <Notice>Only verified students with a rental experience can submit a review.</Notice> : <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-lg font-semibold">Write a Review</h3><Field label="Rating" required><select className={inputClass} name="rating" required defaultValue=""><option value="" disabled>Select a rating</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></Field>
      <Field label="Your Review" required><textarea className={inputClass} name="body" minLength={20} maxLength={2000} rows={4} required placeholder="Describe your rental experience accurately" /></Field>
      <Field label="Rental Experience" required hint="Briefly describe when you stayed here. Do not include private contact or identity details."><textarea className={inputClass} name="experienceDescription" minLength={10} maxLength={500} rows={3} required /></Field>
      {validationError && <Notice tone="error">{validationError}</Notice>}{mutation.isError && <Notice tone="error">{messageOf(mutation.error)}</Notice>}{mutation.isSuccess && <Notice tone="success">Review submitted. It will appear after approval.</Notice>}
      <button className={primaryButton} disabled={mutation.isPending}>{mutation.isPending ? 'Submitting…' : 'Submit for Review'}</button>
    </form>}
  </section>
}

function Inquiry({ listingId, ownerId }: { listingId: string; ownerId?: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [validationError, setValidationError] = useState('')
  const mutation = useMutation({ mutationFn: (message: string) => api(`/listings/${encodeURIComponent(listingId)}/inquiries`, { method: 'POST', body: JSON.stringify({ message }) }) })
  if (user?.id === ownerId) return null
  return <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5" aria-labelledby="inquiry-heading"><h2 id="inquiry-heading" className="text-lg font-bold text-[#0f172a]">Contact Landlord</h2><p className="text-sm text-gray-600">Send an in-app inquiry to ask about this property.</p>
    {!user ? <button className={primaryButton} type="button" onClick={() => navigate(`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`)}>Log in to inquire</button> : !hasRole(user, 'STUDENT') ? <Notice>Student accounts can contact the landlord.</Notice> : <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const message = String(new FormData(form).get('message') || '').trim(); if (message.length < 10 || message.length > 2000) { setValidationError('Write a message between 10 and 2,000 characters.'); return } setValidationError(''); mutation.mutate(message, { onSuccess: () => form.reset() }) }}><Field label="Your Message" required><textarea className={inputClass} name="message" rows={4} minLength={10} maxLength={2000} required placeholder="Hello, I would like to ask about the move-in date and viewing arrangements…" /></Field>{validationError && <Notice tone="error">{validationError}</Notice>}{mutation.isError && <Notice tone="error">{messageOf(mutation.error)}</Notice>}{mutation.isSuccess && <Notice tone="success">Inquiry sent. You can view replies in your request center.</Notice>}<button className={primaryButton} disabled={mutation.isPending}>{mutation.isPending ? 'Sending…' : 'Send Inquiry'}</button></form>}
  </section>
}

function ReportListing({ listingId }: { listingId: string }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [validationError, setValidationError] = useState('')
  const mutation = useMutation({ mutationFn: (payload: { category: string; reason: string }) => api('/reports', { method: 'POST', body: JSON.stringify({ targetType: 'LISTING', targetId: listingId, ...payload }) }) })
  if (!user) return null
  return <div className="space-y-3"><button type="button" className="text-sm font-medium text-rose-700 underline focus:outline-none focus:ring-2 focus:ring-[#203569]" aria-expanded={open} onClick={() => setOpen(!open)}>Report this listing</button>{open && <form noValidate className="space-y-3 rounded-xl border border-gray-200 bg-white p-4" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const reason = String(data.get('reason') || '').trim(); if (reason.length < 10 || reason.length > 1000) { setValidationError('Describe the issue in 10 to 1,000 characters.'); return } setValidationError(''); mutation.mutate({ category: String(data.get('category')), reason }) }}><Field label="Report Category"><select className={inputClass} name="category"><option value="FRAUD">Suspected fraud</option><option value="INACCURATE">Inaccurate information</option><option value="HARASSMENT">Harassment</option><option value="OTHER">Other</option></select></Field><Field label="Details" required><textarea className={inputClass} name="reason" required minLength={10} maxLength={1000} rows={3} /></Field>{validationError && <Notice tone="error">{validationError}</Notice>}{mutation.isError && <Notice tone="error">{messageOf(mutation.error)}</Notice>}{mutation.isSuccess && <Notice tone="success">Report submitted for review.</Notice>}<button className={secondaryButton} disabled={mutation.isPending}>Submit Report</button></form>}</div>
}

export function ListingDetailPage() {
  const { id = '' } = useParams()
  const [photoIndex, setPhotoIndex] = useState(0)
  const listing = useQuery({ queryKey: ['listing', id], queryFn: () => api<ListingDetails>(`/listings/${encodeURIComponent(id)}`), enabled: !!id })
  const record = listing.data
  const photos = record?.photos || []
  const activePhoto = photos[Math.min(photoIndex, photos.length - 1)]
  return <div className="mx-auto max-w-[1000px] px-4 py-8 sm:px-0">
    <Link to="/listings" className="mb-4 inline-flex text-sm font-bold text-gray-500 hover:text-[#203569]">← Back to Housing Search</Link>
    <QueryState loading={listing.isPending} error={listing.error} retry={() => { void listing.refetch() }} empty={!record}>
      {record && <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <section aria-label="Property photos" className="relative h-[220px] bg-[#cbd5e1] sm:h-[300px]">{activePhoto?.url ? <img src={activePhoto.url} alt={activePhoto.alt || `${record.title} photo ${photoIndex + 1}`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-lg font-bold text-gray-500">Property Image Gallery</div>}<span className="absolute bottom-4 left-6 rounded-md bg-[#203569] px-3 py-1.5 text-xs font-bold text-white shadow-sm">{labelOf(roomTypes, record.roomType)}</span></section>
        {photos.length > 1 && <div className="flex gap-2 overflow-x-auto border-b border-gray-100 px-6 py-3">{photos.map((photo, index) => <button key={photo.id || index} type="button" className={`shrink-0 rounded-lg outline-none focus:ring-2 focus:ring-[#203569] ${index === photoIndex ? 'ring-2 ring-[#203569]' : ''}`} aria-label={`View photo ${index + 1}`} aria-pressed={index === photoIndex} onClick={() => setPhotoIndex(index)}><img src={photo.url} alt="" className="h-16 w-24 rounded-lg object-cover" /></button>)}</div>}
        <div className="p-5 sm:p-8">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-5"><div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-[#203569]">{labelOf(propertyTypes, record.propertyType)} · {labelOf(roomTypes, record.roomType)}</p><h1 className="text-2xl font-bold text-[#1f2937]">{record.title}</h1><p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500"><span>Posted by <strong className="text-gray-800">{record.owner?.name || 'Landlord'}</strong></span>{record.status === 'PUBLISHED' && <span className="rounded bg-[#dcfce7] px-2 py-0.5 text-[10px] font-bold text-[#15803d]">✓ Published</span>}{typeof record.distanceKm === 'number' && <span>· {record.distanceKm.toFixed(1)} km to UTS</span>}</p><p className="mt-1 text-sm text-gray-500">{record.approximateArea || record.campusName || 'Area not provided'}</p></div><div className="flex flex-col items-end gap-2"><div className="text-2xl font-bold text-[#16a34a]">{money(record.rent, record.currency)}<span className="text-sm font-normal text-gray-500">/mo</span></div><p className="text-xs font-medium text-gray-400">Deposit: {money(record.deposit, record.currency)}</p><FavoriteButton listingId={id} /></div></header>
          {record.status && record.status !== 'PUBLISHED' && <div className="mb-5"><Notice>This listing is not currently public. Only authorized users can preview it.</Notice></div>}
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]"><div className="min-w-0 space-y-8">
            <section><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">About this property</h2><p className="whitespace-pre-wrap text-sm leading-7 text-gray-600">{record.description || 'The landlord has not added a description yet.'}</p></section>
            <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Property Details</h2><dl className="grid gap-4 rounded-lg bg-[#f8f9fa] p-4 sm:grid-cols-2"><div><dt className="text-xs text-gray-500">Monthly Rent</dt><dd className="font-semibold text-gray-800">{money(record.rent, record.currency)}</dd></div><div><dt className="text-xs text-gray-500">Security Deposit</dt><dd className="font-semibold text-gray-800">{money(record.deposit, record.currency)}</dd></div><div><dt className="text-xs text-gray-500">Available From</dt><dd className="font-semibold text-gray-800">{formatDate(record.availableFrom)}</dd></div><div><dt className="text-xs text-gray-500">Furnishing</dt><dd className="font-semibold text-gray-800">{record.furnished == null ? 'Not provided' : record.furnished ? 'Furnished' : 'Unfurnished'}</dd></div><div><dt className="text-xs text-gray-500">Last Availability Confirmation</dt><dd className="font-semibold text-gray-800">{formatDate(record.lastConfirmedAt)}</dd></div><div><dt className="text-xs text-gray-500">Distance to UTS</dt><dd className="font-semibold text-gray-800">{typeof record.distanceKm === 'number' ? `${record.distanceKm.toFixed(1)} km (straight line)` : 'Not provided'}</dd></div></dl></section>
            {record.amenities?.length ? <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Included Facilities</h2><ul className="flex flex-wrap gap-2.5">{record.amenities.map(amenity => <li key={amenity} className="rounded-full bg-[#f0f4f8] px-3.5 py-1.5 text-xs font-bold text-[#203569]">✓ {amenity}</li>)}</ul></section> : null}
            {record.houseRules && <section><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">House Rules</h2><p className="whitespace-pre-wrap text-sm leading-6 text-gray-600">{record.houseRules}</p></section>}
            <section><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">Approximate Location</h2><p className="text-sm text-gray-600">{record.approximateArea || 'Area not provided'}</p><p className="mt-1 text-xs text-gray-400">The exact address is shared only with the landlord's consent.</p></section>
            <Reviews listingId={id} /><ReportListing listingId={id} />
          </div><aside className="space-y-4 lg:self-start"><Inquiry listingId={id} ownerId={record.ownerId || record.owner?.id} />{record.reviewCount != null && <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">{record.reviewCount} approved reviews{record.rating != null ? ` · ${Number(record.rating).toFixed(1)} / 5` : ''}</div>}<p className="text-xs text-gray-400">Availability is provided by the landlord and may change.</p></aside></div>
        </div>
      </div>}
    </QueryState>
  </div>
}
