import { useI18n } from '../../lib/i18n'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { money } from '../../lib/types'
import { FavoriteButton, Field, inputClass, Notice, primaryButton, QueryState, secondaryButton } from './components'
import { formatDate, getList, labelOf, propertyTypes, roomTypes, type ListingDetails, type Review } from './model'

function Reviews({ listingId }: { listingId: string }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const client = useQueryClient()
  const [validationError, setValidationError] = useState('')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const reviews = useInfiniteQuery({
    queryKey: ['listing-reviews', listingId, 'public'],
    queryFn: ({ pageParam }) => getList<Review>(`/listings/${encodeURIComponent(listingId)}/reviews?page=${pageParam}&limit=10`),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => last.pages && pages.length < last.pages ? pages.length + 1 : undefined,
  })
  const reviewItems = reviews.data?.pages.flatMap(page => page.items) || []
  const mutation = useMutation({ mutationFn: async (payload: { rating: number; body: string; experienceDescription: string; proof: File }) => {
    const signed = await api<{ uploadUrl: string; objectKey: string; headers?: Record<string, string> }>('/uploads/sign', { method: 'POST', body: JSON.stringify({ fileName: payload.proof.name, contentType: payload.proof.type, size: payload.proof.size, purpose: 'REVIEW_EVIDENCE' }) })
    if (!signed.uploadUrl || !signed.objectKey) throw new Error('The server did not provide a valid proof upload URL.')
    const uploaded = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': payload.proof.type, ...signed.headers }, body: payload.proof })
    if (!uploaded.ok) throw new Error('Could not upload the rental proof. Please try again.')
    return api(`/listings/${encodeURIComponent(listingId)}/reviews`, { method: 'POST', body: JSON.stringify({ rating: payload.rating, body: payload.body, experienceDescription: payload.experienceDescription, experienceProofKey: signed.objectKey }) })
  }, onSuccess: async () => { setProofFile(null); await client.invalidateQueries({ queryKey: ['listing-reviews', listingId] }) } })
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
    if (!proofFile) { setValidationError('Attach a private document showing your rental experience.'); return }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(proofFile.type) || proofFile.size > 5_000_000) { setValidationError('Choose a PDF, JPG or PNG proof file no larger than 5 MB.'); return }
    setValidationError('')
    mutation.mutate({ rating, body, experienceDescription, proof: proofFile }, { onSuccess: () => form.reset() })
  }
  return <section className="space-y-5" aria-labelledby="reviews-heading">
    <div><h2 id="reviews-heading" className="text-lg font-bold text-[#0f172a]">{t('Student Reviews')}</h2><p className="mt-1 text-sm text-gray-600">{t('Only approved reviews are shown. Students must verify their rental experience before posting.')}</p></div>
    {reviews.isPending ? <p role="status" className="text-gray-500">{t('Loading reviews…')}</p> : reviews.isError ? <Notice tone="error">{t(messageOf(reviews.error))}</Notice> : reviewItems.length ? <div className="space-y-3">{reviewItems.map(review => <article key={review.id} className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{review.author?.name || review.authorName || t('Student')}</strong><span className="text-sm text-gray-500">{formatDate(review.createdAt)}</span></div>
      <p aria-label={t('{rating} out of 5 stars', { rating: review.rating })} className="mt-1 text-amber-700">{'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}{'☆'.repeat(5 - Math.max(0, Math.min(5, Number(review.rating) || 0)))}</p>
      <p className="mt-2 whitespace-pre-wrap text-gray-700">{review.body}</p>
      {review.ownerResponse && <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-[#203569]"><strong>{t('Landlord response')}</strong><p className="mt-1 whitespace-pre-wrap">{review.ownerResponse}</p></div>}
      <ReportReview reviewId={review.id} />
    </article>)}</div> : <Notice>{t('No approved reviews yet.')}</Notice>}
    {reviews.hasNextPage && <div className="text-center"><button type="button" className={secondaryButton} disabled={reviews.isFetchingNextPage} onClick={() => void reviews.fetchNextPage()}>{reviews.isFetchingNextPage ? t('Loading…') : t('Load more reviews')}</button></div>}
    {!user ? <p className="text-sm text-gray-600"><Link to={`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`} className="font-semibold text-[#203569] underline">{t('Log in')}</Link> {t('to request a review.')}</p> : !hasRole(user, 'STUDENT') || !user.studentVerified ? <Notice>{t('Only verified students with a rental experience can submit a review.')}</Notice> : <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-lg font-semibold">{t('Write a Review')}</h3><Field label={t('Rating')} required><select className={inputClass} name="rating" required defaultValue=""><option value="" disabled>{t('Select a rating')}</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></Field>
      <Field label={t('Your Review')} required><textarea className={inputClass} name="body" minLength={20} maxLength={2000} rows={4} required placeholder={t('Describe your rental experience accurately')} /></Field>
      <Field label={t('Rental Experience')} required hint={t('Briefly describe when you stayed here. Do not include private contact or identity details.')}><textarea className={inputClass} name="experienceDescription" minLength={10} maxLength={500} rows={3} required /></Field>
      <div><span id="review-proof-label" className="block text-[13px] font-bold text-[#374151]">{t('Proof of Rental Experience')} <span className="text-rose-700" aria-hidden="true">*</span></span><label className="mt-1.5 flex min-h-11 cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-[#203569]"><input type="file" className="sr-only" aria-labelledby="review-proof-label" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={event => { setProofFile(event.currentTarget.files?.[0] || null); setValidationError('') }} /><span aria-hidden="true" className="rounded-md bg-[#203569] px-3 py-1.5 text-xs font-semibold text-white">{t('Choose file')}</span><span className="min-w-0 flex-1 truncate text-sm text-gray-600">{proofFile?.name || t('No file selected')}</span></label><p className="mt-1 text-xs text-gray-500">{t('PDF, JPG or PNG up to 5 MB. The document is private and is used only to check review eligibility.')}</p></div>
      {validationError && <Notice tone="error">{t(validationError)}</Notice>}{mutation.isError && <Notice tone="error">{t(messageOf(mutation.error))}</Notice>}{mutation.isSuccess && <Notice tone="success">{t('Review submitted. It will appear after approval.')}</Notice>}
      <button className={primaryButton} disabled={mutation.isPending}>{mutation.isPending ? t('Submitting…') : t('Submit for Review')}</button>
    </form>}
  </section>
}

function ReportReview({ reviewId }: { reviewId: string }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState('FABRICATED')
  const [validation, setValidation] = useState('')
  const report = useMutation({
    mutationFn: () => api('/reports', { method: 'POST', body: JSON.stringify({ targetType: 'REVIEW', targetId: reviewId, category, reason: reason.trim() }) }),
  })
  if (!user) return null
  return <div className="mt-4 border-t border-gray-100 pt-3 text-sm">
    <button type="button" className="font-medium text-rose-700 underline" aria-expanded={open} onClick={() => setOpen(value => !value)}>{t('Report review')}</button>
    {open && <form className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-[#f8f9fa] p-4" onSubmit={event => { event.preventDefault(); if (reason.trim().length < 10 || reason.trim().length > 1000) { setValidation('Describe the issue in 10 to 1,000 characters.'); return } setValidation(''); report.mutate() }} noValidate>
      <Field label={t('Reason')}><select className={inputClass} value={category} onChange={event => setCategory(event.target.value)}><option value="FABRICATED">{t('Possibly fabricated')}</option><option value="HARASSMENT">{t('Harassment')}</option><option value="PERSONAL_DATA">{t('Private information')}</option><option value="OTHER">{t('Other concern')}</option></select></Field>
      <Field label={t('Details')} required><textarea className={inputClass} value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={1000} required /></Field>
      {validation && <Notice tone="error">{t(validation)}</Notice>}{report.isError && <Notice tone="error">{t(messageOf(report.error))}</Notice>}{report.isSuccess && <Notice tone="success">{t('This review was reported for moderation.')}</Notice>}
      <button type="submit" className={secondaryButton} disabled={report.isPending || report.isSuccess}>{report.isPending ? t('Sending…') : t('Submit report')}</button>
    </form>}
  </div>
}

function Inquiry({ listingId, ownerId }: { listingId: string; ownerId?: string }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [validationError, setValidationError] = useState('')
  const mutation = useMutation({ mutationFn: (message: string) => api(`/listings/${encodeURIComponent(listingId)}/inquiries`, { method: 'POST', body: JSON.stringify({ message }) }) })
  if (user?.id === ownerId) return null
  return <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5" aria-labelledby="inquiry-heading"><h2 id="inquiry-heading" className="text-lg font-bold text-[#0f172a]">{t('Contact Landlord')}</h2><p className="text-sm text-gray-600">{t('Send an in-app inquiry to ask about this property.')}</p>
    {!user ? <button className={primaryButton} type="button" onClick={() => navigate(`/login?next=${encodeURIComponent(`/listings/${listingId}`)}`)}>{t('Log in to inquire')}</button> : !hasRole(user, 'STUDENT') ? <Notice>{t('Student accounts can contact the landlord.')}</Notice> : <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const message = String(new FormData(form).get('message') || '').trim(); if (message.length < 10 || message.length > 2000) { setValidationError('Write a message between 10 and 2,000 characters.'); return } setValidationError(''); mutation.mutate(message, { onSuccess: () => form.reset() }) }}><Field label={t('Your Message')} required><textarea className={inputClass} name="message" rows={4} minLength={10} maxLength={2000} required placeholder={t('Hello, I would like to ask about the move-in date and viewing arrangements…')} /></Field>{validationError && <Notice tone="error">{t(validationError)}</Notice>}{mutation.isError && <Notice tone="error">{t(messageOf(mutation.error))}</Notice>}{mutation.isSuccess && <Notice tone="success">{t('Inquiry sent. You can view replies in your request center.')}</Notice>}<button className={primaryButton} disabled={mutation.isPending}>{mutation.isPending ? t('Sending…') : t('Send Inquiry')}</button></form>}
  </section>
}

function ReportListing({ listingId }: { listingId: string }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [validationError, setValidationError] = useState('')
  const mutation = useMutation({ mutationFn: (payload: { category: string; reason: string }) => api('/reports', { method: 'POST', body: JSON.stringify({ targetType: 'LISTING', targetId: listingId, ...payload }) }) })
  if (!user) return null
  return <div className="space-y-3"><button type="button" className="text-sm font-medium text-rose-700 underline focus:outline-none focus:ring-2 focus:ring-[#203569]" aria-expanded={open} onClick={() => setOpen(!open)}>{t('Report this listing')}</button>{open && <form noValidate className="space-y-3 rounded-xl border border-gray-200 bg-white p-4" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const reason = String(data.get('reason') || '').trim(); if (reason.length < 10 || reason.length > 1000) { setValidationError('Describe the issue in 10 to 1,000 characters.'); return } setValidationError(''); mutation.mutate({ category: String(data.get('category')), reason }) }}><Field label={t('Report Category')}><select className={inputClass} name="category"><option value="FRAUD">{t('Suspected fraud')}</option><option value="INACCURATE">{t('Inaccurate information')}</option><option value="HARASSMENT">{t('Harassment')}</option><option value="OTHER">{t('Other')}</option></select></Field><Field label={t('Details')} required><textarea className={inputClass} name="reason" required minLength={10} maxLength={1000} rows={3} /></Field>{validationError && <Notice tone="error">{t(validationError)}</Notice>}{mutation.isError && <Notice tone="error">{t(messageOf(mutation.error))}</Notice>}{mutation.isSuccess && <Notice tone="success">{t('Report submitted for review.')}</Notice>}<button className={secondaryButton} disabled={mutation.isPending}>{t('Submit Report')}</button></form>}</div>
}

export function ListingDetailPage() {
  const { t } = useI18n()
  const { id = '' } = useParams()
  const [photoIndex, setPhotoIndex] = useState(0)
  const listing = useQuery({ queryKey: ['listing', id], queryFn: () => api<ListingDetails>(`/listings/${encodeURIComponent(id)}`), enabled: !!id })
  const record = listing.data
  const fullAddress = record?.address?.trim()
  const photos = record?.photos || []
  const activePhoto = photos[Math.min(photoIndex, photos.length - 1)]
  return <div className="mx-auto max-w-[1000px] px-4 py-8 sm:px-0">
    <Link to="/listings" className="mb-4 inline-flex text-sm font-bold text-gray-500 hover:text-[#203569]">{t('← Back to Housing Search')}</Link>
    <QueryState loading={listing.isPending} error={listing.error} retry={() => { void listing.refetch() }} empty={!record}>
      {record && <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <section aria-label={t('Property photos')} className="relative h-[220px] bg-[#cbd5e1] sm:h-[300px]">{activePhoto?.url ? <img src={activePhoto.url} alt={activePhoto.alt || t('{title} photo {number}', { title: record.title, number: photoIndex + 1 })} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-lg font-bold text-gray-500">{t('Property Image Gallery')}</div>}<span className="absolute bottom-4 left-6 rounded-md bg-[#203569] px-3 py-1.5 text-xs font-bold text-white shadow-sm">{labelOf(roomTypes, record.roomType)}</span></section>
        {photos.length > 1 && <div className="flex gap-2 overflow-x-auto border-b border-gray-100 px-6 py-3">{photos.map((photo, index) => <button key={photo.id || index} type="button" className={`shrink-0 rounded-lg outline-none focus:ring-2 focus:ring-[#203569] ${index === photoIndex ? 'ring-2 ring-[#203569]' : ''}`} aria-label={t('View photo {number}', { number: index + 1 })} aria-pressed={index === photoIndex} onClick={() => setPhotoIndex(index)}><img src={photo.url} alt="" className="h-16 w-24 rounded-lg object-cover" /></button>)}</div>}
        <div className="p-5 sm:p-8">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-5"><div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-[#203569]">{t(labelOf(propertyTypes, record.propertyType))} · {t(labelOf(roomTypes, record.roomType))}</p><h1 className="text-2xl font-bold text-[#1f2937]">{record.title}</h1><p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500"><span>{t('Posted by')} <strong className="text-gray-800">{record.owner?.name || t('Landlord')}</strong></span>{record.status === 'PUBLISHED' && <span className="rounded bg-[#dcfce7] px-2 py-0.5 text-[10px] font-bold text-[#15803d]">{t('✓ Published')}</span>}</p><p className="mt-1 text-sm text-gray-500">{record.approximateArea || record.campusName || t('Area not provided')}</p></div><div className="flex flex-col items-end gap-2"><div className="text-2xl font-bold text-[#16a34a]">{money(record.rent, record.currency)}<span className="text-sm font-normal text-gray-500">{t('/mo')}</span></div><p className="text-xs font-medium text-gray-400">{t('Deposit:')} {money(record.deposit, record.currency)}</p><FavoriteButton listingId={id} /></div></header>
          {record.status && record.status !== 'PUBLISHED' && <div className="mb-5"><Notice>{t('This listing is not currently public. Only authorized users can preview it.')}</Notice></div>}
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]"><div className="min-w-0 space-y-8">
            <section><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">{t('About this property')}</h2><p className="whitespace-pre-wrap text-sm leading-7 text-gray-600">{record.description || t('The landlord has not added a description yet.')}</p></section>
            <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">{t('Property Details')}</h2><dl className="grid gap-4 rounded-lg bg-[#f8f9fa] p-4 sm:grid-cols-2"><div><dt className="text-xs text-gray-500">{t('Monthly Rent')}</dt><dd className="font-semibold text-gray-800">{money(record.rent, record.currency)}</dd></div><div><dt className="text-xs text-gray-500">{t('Security Deposit')}</dt><dd className="font-semibold text-gray-800">{money(record.deposit, record.currency)}</dd></div><div><dt className="text-xs text-gray-500">{t('Available From')}</dt><dd className="font-semibold text-gray-800">{formatDate(record.availableFrom)}</dd></div><div><dt className="text-xs text-gray-500">{t('Furnishing')}</dt><dd className="font-semibold text-gray-800">{record.furnished == null ? t('Not provided') : record.furnished ? t('Furnished') : t('Unfurnished')}</dd></div><div><dt className="text-xs text-gray-500">{t('Last Availability Confirmation')}</dt><dd className="font-semibold text-gray-800">{formatDate(record.lastConfirmedAt)}</dd></div></dl></section>
            {record.amenities?.length ? <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">{t('Included Facilities')}</h2><ul className="flex flex-wrap gap-2.5">{record.amenities.map(amenity => <li key={amenity} className="rounded-full bg-[#f0f4f8] px-3.5 py-1.5 text-xs font-bold text-[#203569]">✓ {t(amenity)}</li>)}</ul></section> : null}
            {record.houseRules && <section><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">{t('House Rules')}</h2><p className="whitespace-pre-wrap text-sm leading-6 text-gray-600">{record.houseRules}</p></section>}
            <section><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">{fullAddress ? t('Full Property Address') : t('Approximate Location')}</h2><p className="whitespace-pre-wrap text-sm text-gray-600">{fullAddress || record.approximateArea || t('Area not provided')}</p>{fullAddress ? <p className="mt-1 text-xs text-gray-500">{record.showExactLocation ? t('Address provided by the landlord. Confirm it before visiting.') : t('This address is private to you and administrators until you choose to share it with students.')}</p> : <p className="mt-1 text-xs text-gray-400">{t('The landlord has not shared the full address. Ask about it before arranging a viewing.')}</p>}</section>
            <Reviews listingId={id} /><ReportListing listingId={id} />
          </div><aside className="space-y-4 lg:self-start"><Inquiry listingId={id} ownerId={record.ownerId || record.owner?.id} />{record.reviewCount != null && <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">{t('{count} approved reviews', { count: record.reviewCount })}{record.rating != null ? ` · ${Number(record.rating).toFixed(1)} / 5` : ''}</div>}<p className="text-xs text-gray-400">{t('Availability is provided by the landlord and may change.')}</p></aside></div>
        </div>
      </div>}
    </QueryState>
  </div>
}
