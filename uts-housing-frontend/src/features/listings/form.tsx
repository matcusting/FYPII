import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, messageOf } from '../../lib/api'
import { EnglishDateInput, isIsoDate } from '../../components/EnglishDateInput'
import { hasRole, useAuth } from '../../lib/auth'
import { Field, inputClass, Notice, primaryButton, QueryState, secondaryButton } from './components'
import { getList, propertyTypes, roomTypes, statusNames, type Amenity, type Campus, type ListingDetails } from './model'

interface SignedUpload {
  uploadUrl: string
  objectKey: string
  headers?: Record<string, string>
}

async function uploadPhotos(files: File[]): Promise<string[]> {
  const keys: string[] = []
  for (const file of files) {
    const signed = await api<SignedUpload>('/uploads/sign', { method: 'POST', body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }) })
    if (!signed.uploadUrl || !signed.objectKey) throw new Error('The server did not provide a valid photo upload URL.')
    const response = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type, ...signed.headers }, body: file })
    if (!response.ok) throw new Error(`Could not upload ${file.name}. Please try again.`)
    keys.push(signed.objectKey)
  }
  return keys
}

function ListingEditor({ initial, campuses, amenities }: { initial?: ListingDetails; campuses: Campus[]; amenities: Amenity[] }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [files, setFiles] = useState<File[]>([])
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([])
  const [selectedAmenityIds, setSelectedAmenityIds] = useState<string[]>(initial?.amenityIds || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState('')
  const photoCount = (initial?.photos || []).filter(photo => !photo.id || !removedPhotoIds.includes(photo.id)).length + files.length
  const maySubmit = hasRole(user, 'LANDLORD', 'ADMIN') || (!!user?.studentVerified && hasRole(user, 'STUDENT'))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const action = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const submitForReview = action?.value === 'review'
    if (submitForReview && !maySubmit) { setError('Complete student verification before submitting a listing for review.'); return }
    if (submitForReview && photoCount < 1) { setError('Upload at least one property photo before submitting for review.'); return }
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') || '').trim()
    const description = String(form.get('description') || '').trim()
    const approximateArea = String(form.get('approximateArea') || '').trim()
    const campusId = String(form.get('campusId') || '')
    const propertyType = String(form.get('propertyType') || '')
    const roomType = String(form.get('roomType') || '')
    if (title.length < 8 || title.length > 120) { setError('Enter a listing title between 8 and 120 characters.'); return }
    if (!campusId || !propertyType || !roomType) { setError('Select a campus, property type and room type.'); return }
    if (approximateArea.length < 3 || approximateArea.length > 120) { setError('Enter an approximate area between 3 and 120 characters.'); return }
    if (description.length < 30 || description.length > 5000) { setError('Enter a property description between 30 and 5,000 characters.'); return }
    const rentText = String(form.get('rent') || '').trim()
    const depositText = String(form.get('deposit') || '').trim()
    const rent = Number(rentText)
    const deposit = Number(depositText)
    if (!/^\d+(\.\d{1,2})?$/.test(rentText) || !/^\d+(\.\d{1,2})?$/.test(depositText) || rent <= 0 || deposit < 0 || rent > 9999999 || deposit > 9999999) { setError('Enter valid monthly rent and deposit amounts with up to two decimal places.'); return }
    const availableFrom = String(form.get('availableFrom') || '').trim()
    if (!isIsoDate(availableFrom)) { setError('Enter a valid available-from date as YYYY-MM-DD.'); return }
    const payload: Record<string, unknown> = {
      title,
      description,
      campusId,
      propertyType,
      roomType,
      rent: rent.toFixed(2),
      currency: 'MYR',
      deposit: deposit.toFixed(2),
      availableFrom,
      approximateArea,
      houseRules: String(form.get('houseRules') || '').trim(),
      contactMethod: String(form.get('contactMethod') || 'IN_APP'),
      furnished: form.get('furnished') === 'true',
      amenityIds: selectedAmenityIds,
    }
    setSaving(true)
    setError(null)
    try {
      let uploadedKeys: string[] = []
      if (files.length) { setUploadProgress(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…`); uploadedKeys = await uploadPhotos(files) }
      if (initial) {
        if (uploadedKeys.length) payload.newPhotoKeys = uploadedKeys
        if (removedPhotoIds.length) payload.removePhotoIds = removedPhotoIds
      } else if (uploadedKeys.length) payload.photoKeys = uploadedKeys
      setUploadProgress('Saving listing…')
      const saved = initial
        ? await api<ListingDetails>(`/listings/${encodeURIComponent(initial.id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<ListingDetails>('/listings', { method: 'POST', body: JSON.stringify(payload) })
      const id = saved?.id || initial?.id
      if (!id) throw new Error('The listing was saved, but the server did not return its ID. Check My Listings.')
      if (submitForReview) { setUploadProgress('Submitting for review…'); await api(`/listings/${encodeURIComponent(id)}/submit`, { method: 'POST' }) }
      navigate('/my-listings', { state: { listingSaved: true } })
    } catch (failure) { setError(messageOf(failure)) }
    finally { setSaving(false); setUploadProgress('') }
  }

  return <form noValidate className="max-w-4xl space-y-7" onSubmit={event => { void submit(event) }}>
    <Field label="Listing Title" required><input className={inputClass} name="title" required minLength={8} maxLength={120} defaultValue={initial?.title || ''} placeholder="e.g., Master Room at Taman Universiti" /></Field>
    <div><p className="mb-2 text-[13px] font-bold text-[#374151]">Property Photo</p>
      {initial?.photos?.length ? <div className="mb-3 grid gap-3 sm:grid-cols-3">{initial.photos.map((photo, index) => <label key={photo.id || index} className="overflow-hidden rounded-lg border border-gray-200"><img src={photo.url} alt={photo.alt || `Existing photo ${index + 1}`} className="h-28 w-full object-cover" /><span className="flex items-center gap-2 p-2 text-xs"><input type="checkbox" disabled={!photo.id} checked={!!photo.id && removedPhotoIds.includes(photo.id)} onChange={() => { if (photo.id) setRemovedPhotoIds(value => value.includes(photo.id!) ? value.filter(id => id !== photo.id) : [...value, photo.id!]) }} />Remove this photo</span></label>)}</div> : null}
      <label className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#cbd5e1] bg-[#f8f9fa] px-4 text-center transition hover:border-[#203569]"><span aria-hidden="true" className="text-3xl">📷</span><span className="mt-2 text-sm font-bold text-[#475569]">Click to upload property photos</span><span className="mt-1 text-xs text-[#94a3b8]">Supports JPG, PNG, WEBP (Max 5MB each, up to 8)</span><input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" multiple onChange={event => { const selected = Array.from(event.currentTarget.files || []); const existing = (initial?.photos?.length || 0) - removedPhotoIds.length; if (selected.length + existing > 8) { setError('You can keep up to 8 photos.'); event.currentTarget.value = ''; setFiles([]); return } if (selected.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) { setError('Choose JPEG, PNG, or WebP photos under 5 MB each.'); event.currentTarget.value = ''; setFiles([]); return } setError(null); setFiles(selected) }} /></label>
      {files.length > 0 && <p className="mt-2 text-xs text-gray-600">Ready to upload: {files.map(file => file.name).join(', ')}</p>}
    </div>
    <div className="grid gap-6 sm:grid-cols-2"><Field label="Monthly Rent (RM)" required><input className={inputClass} name="rent" type="number" min="1" max="9999999" step="0.01" required defaultValue={initial?.rent || ''} placeholder="0.00" /></Field><Field label="Security Deposit (RM)" required><input className={inputClass} name="deposit" type="number" min="0" max="9999999" step="0.01" required defaultValue={initial?.deposit ?? 0} placeholder="0.00" /></Field></div>
    <div className="grid gap-6 sm:grid-cols-2"><Field label="Campus" required><select className={inputClass} name="campusId" required defaultValue={initial?.campusId || ''}><option value="" disabled>Select campus</option>{campuses.map(campus => <option key={campus.id} value={campus.id}>{campus.name}{campus.university ? ` · ${campus.university}` : ''}</option>)}</select></Field><Field label="Room Type" required><select className={inputClass} name="roomType" required defaultValue={initial?.roomType || ''}><option value="" disabled>Select room type</option>{roomTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
    <div className="grid gap-6 sm:grid-cols-2"><Field label="Property Type" required><select className={inputClass} name="propertyType" required defaultValue={initial?.propertyType || ''}><option value="" disabled>Select property type</option>{propertyTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><div className="space-y-1.5 text-[13px] font-bold text-[#374151]"><label htmlFor="available-from">Available From <span className="text-rose-700" aria-hidden="true">*</span></label><EnglishDateInput id="available-from" className={inputClass} name="availableFrom" required defaultValue={initial?.availableFrom?.slice(0, 10) || ''} /></div></div>
    <div className="grid gap-6 sm:grid-cols-2"><Field label="Approximate Area" required hint="Only the general area is shown publicly."><input className={inputClass} name="approximateArea" required minLength={3} maxLength={120} defaultValue={initial?.approximateArea || ''} placeholder="e.g., Sibu Jaya" /></Field><Field label="Furnishing"><select className={inputClass} name="furnished" defaultValue={String(initial?.furnished ?? false)}><option value="false">Unfurnished</option><option value="true">Furnished</option></select></Field></div>
    <Field label="Property Description" required><textarea className={inputClass} name="description" required minLength={30} maxLength={5000} rows={4} defaultValue={initial?.description || ''} placeholder="Describe the room, furniture, transport and included costs" /></Field>
    <div><p className="mb-3 text-[13px] font-bold text-[#374151]">Included Facilities (Select all that apply)</p>{amenities.length ? <div className="flex flex-wrap gap-2">{amenities.map(amenity => { const selected = selectedAmenityIds.includes(amenity.id); return <label key={amenity.id} className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-bold transition ${selected ? 'border-[#203569] bg-[#203569] text-white' : 'border-gray-200 bg-[#f1f3f5] text-[#64748b] hover:border-[#203569]'}`}><input type="checkbox" className="sr-only" checked={selected} onChange={() => setSelectedAmenityIds(value => value.includes(amenity.id) ? value.filter(id => id !== amenity.id) : [...value, amenity.id])} />{selected ? '✓ ' : '+ '}{amenity.name}</label> })}</div> : <p className="text-sm text-gray-500">Facilities are temporarily unavailable. You can still save your listing.</p>}</div>
    <Field label="House Rules"><textarea className={inputClass} name="houseRules" rows={3} maxLength={2000} defaultValue={initial?.houseRules || ''} placeholder="e.g., No smoking, visitor hours" /></Field>
    <Field label="Contact Method"><select className={inputClass} name="contactMethod" defaultValue="IN_APP"><option value="IN_APP">In-app inquiry</option></select></Field>
    {initial?.status === 'PUBLISHED' && <Notice>Editing a published listing may require another review. Check its status after saving.</Notice>}{!maySubmit && <Notice>Unverified students can save drafts. Complete student verification before submitting for review.</Notice>}{error && <Notice tone="error">{error}</Notice>}{saving && <p role="status" className="text-sm text-[#203569]">{uploadProgress}</p>}
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 pt-6"><Link className={secondaryButton} to="/my-listings">Cancel</Link><button className={secondaryButton} type="submit" value="draft" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save Changes' : 'Save Draft'}</button><button className={primaryButton} type="submit" value="review" disabled={saving || !maySubmit || initial?.status === 'PENDING_REVIEW' || initial?.status === 'PUBLISHED'}>{saving ? 'Submitting…' : 'Publish to Student Database'}</button></div>
  </form>
}

export function ListingFormPage() {
  const { id } = useParams()
  const listing = useQuery({ queryKey: ['listing-edit', id], queryFn: () => api<ListingDetails>(`/listings/${encodeURIComponent(id!)}`), enabled: !!id })
  const campuses = useQuery({ queryKey: ['campuses'], queryFn: () => getList<Campus>('/campuses') })
  const amenities = useQuery({ queryKey: ['amenities'], queryFn: () => getList<Amenity>('/amenities'), retry: false })
  const { user } = useAuth()
  if (!hasRole(user, 'STUDENT', 'LANDLORD', 'ADMIN')) return <div className="mx-auto max-w-4xl px-4 py-12"><Notice tone="error">This account cannot publish listings.</Notice></div>
  return <div className="space-y-6 p-5 sm:p-10"><div className="max-w-4xl border-b border-gray-100 pb-4"><h1 className="text-[1.4rem] font-bold text-[#0f172a]">{id ? 'Edit Property Details' : 'Publish a New Listing'}</h1>{id && listing.data?.status && <p className="mt-2 text-xs text-gray-500">Current status: {statusNames[listing.data.status] || listing.data.status} · <Link to="/my-listings" className="font-semibold text-[#203569] hover:underline">Back to Manage Properties</Link></p>}</div>
    {amenities.isError && <Notice>Facilities are temporarily unavailable. You can still complete the other details.</Notice>}
    <QueryState loading={(!!id && listing.isPending) || campuses.isPending} error={listing.error || campuses.error} retry={() => { if (listing.isError) void listing.refetch(); if (campuses.isError) void campuses.refetch() }} empty={!!id && !listing.data}><ListingEditor key={`${id || 'new'}-${listing.data?.updatedAt || ''}`} initial={listing.data} campuses={campuses.data?.items || []} amenities={amenities.data?.items || []} /></QueryState>
  </div>
}
