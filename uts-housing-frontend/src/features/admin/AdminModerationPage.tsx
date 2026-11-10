import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiResourceUrl, itemsOf, messageOf } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { PreviewDocumentNotice } from '../../components/PreviewDocumentNotice'
import { AdminShell, Notice, QueryState } from './shared'
import { asRecord, dateText, firstText, nestedText, type DataRecord } from './data'

type ModerationKind = 'verifications' | 'landlord-verifications' | 'property-authorizations' | 'listings' | 'reviews' | 'reports' | 'accounts'

const configuration: Record<ModerationKind, {
  title: string
  description: string
  singular: string
  approve: string
  reject: string
  approveLabel: string
  rejectLabel: string
  extraAction?: { value: string; label: string }
  statuses: Array<{ value: string; label: string }>
}> = {
  verifications: {
    title: 'Student Verification', description: 'Review student identity, approve or reject applications, and record the reason for each decision.', singular: 'verification request',
    approve: 'APPROVED', reject: 'REJECTED', approveLabel: 'Approve verification', rejectLabel: 'Reject verification',
    statuses: [{ value: 'PENDING', label: 'Pending review' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }],
  },
  'landlord-verifications': {
    title: 'Landlord Identity Review', description: 'Review landlord identity documents privately before the landlord can request property authorization.', singular: 'landlord identity request',
    approve: 'APPROVED', reject: 'REJECTED', approveLabel: 'Approve identity', rejectLabel: 'Reject identity',
    extraAction: { value: 'REVOKED', label: 'Revoke approval' },
    statuses: [{ value: 'PENDING', label: 'Pending review' }, { value: 'APPROVED', label: 'Approved' }, { value: 'EXPIRED', label: 'Expired' }, { value: 'REVOKED', label: 'Revoked' }, { value: 'REJECTED', label: 'Rejected' }],
  },
  'property-authorizations': {
    title: 'Property Authorization Review', description: 'Check the full address and evidence of the right to list each property before publication.', singular: 'property authorization request',
    approve: 'APPROVED', reject: 'REJECTED', approveLabel: 'Approve authorization', rejectLabel: 'Reject authorization',
    extraAction: { value: 'REVOKED', label: 'Revoke approval' },
    statuses: [{ value: 'PENDING', label: 'Pending review' }, { value: 'APPROVED', label: 'Approved' }, { value: 'EXPIRED', label: 'Expired' }, { value: 'REVOKED', label: 'Revoked' }, { value: 'REJECTED', label: 'Rejected' }],
  },
  listings: {
    title: 'Listing Review', description: 'Check each listing\'s content, location, and details before deciding whether it can be published.', singular: 'listing',
    approve: 'PUBLISHED', reject: 'REJECTED', approveLabel: 'Approve publication', rejectLabel: 'Reject publication',
    extraAction: { value: 'PAUSED', label: 'Pause listing' },
    statuses: [{ value: 'PENDING_REVIEW', label: 'Pending review' }, { value: 'PUBLISHED', label: 'Published' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'PAUSED', label: 'Paused' }],
  },
  reviews: {
    title: 'Review Moderation', description: 'Review ratings and evidence for policy violations or privacy concerns.', singular: 'review',
    approve: 'APPROVED', reject: 'REJECTED', approveLabel: 'Approve review', rejectLabel: 'Reject review',
    statuses: [{ value: 'PENDING', label: 'Pending review' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }],
  },
  reports: {
    title: 'Report Review', description: 'Investigate reports and record the outcome. Any account restrictions must be authorized by the server.', singular: 'report',
    approve: 'RESOLVED', reject: 'DISMISSED', approveLabel: 'Mark resolved', rejectLabel: 'Dismiss report',
    statuses: [{ value: 'OPEN', label: 'Open' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'DISMISSED', label: 'Dismissed' }],
  },
  accounts: {
    title: 'Account Management', description: 'Review account status and suspend or restore accounts when needed. The server must audit every change.', singular: 'account',
    approve: 'ACTIVE', reject: 'SUSPENDED', approveLabel: 'Restore account', rejectLabel: 'Suspend account',
    statuses: [{ value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }],
  },
}

const statusLabels: Record<string, string> = {
  PENDING: 'Pending review', PENDING_REVIEW: 'Pending review', SUBMITTED: 'Submitted', OPEN: 'Open',
  APPROVED: 'Approved', VERIFIED: 'Verified', PUBLISHED: 'Published',
  REJECTED: 'Rejected', RESOLVED: 'Resolved', DISMISSED: 'Dismissed',
  EXPIRED: 'Expired', REVOKED: 'Revoked',
  PAUSED: 'Paused', ARCHIVED: 'Archived',
  ACTIVE: 'Active', SUSPENDED: 'Suspended',
}

function rowsOf(value: unknown, kind: ModerationKind): DataRecord[] {
  const direct = itemsOf<unknown>(value)
  const named = asRecord(value)?.[kind]
  const source = direct.length ? direct : Array.isArray(named) ? named : direct
  return source.map(asRecord).filter((row): row is DataRecord => row !== null)
}

function pageCount(value: unknown): number | null {
  const record = asRecord(value)
  const pagination = asRecord(record?.pagination)
  const number = Number(record?.pages ?? record?.totalPages ?? pagination?.pages ?? pagination?.totalPages)
  return Number.isInteger(number) && number > 0 ? number : null
}

type Translate = (english: string, vars?: Record<string, string | number>) => string

function rowTitle(row: DataRecord, kind: ModerationKind, t: Translate): string {
  if (kind === 'accounts') return firstText(row, 'name', 'displayName', 'email') || t('Account name unavailable')
  if (kind === 'landlord-verifications') return nestedText(row, 'landlord', 'name', 'email') || t('Applicant unavailable')
  if (kind === 'property-authorizations') return nestedText(row, 'listing', 'title') || t('Listing title unavailable')
  if (kind === 'verifications') return nestedText(row, 'student', 'name', 'email') || nestedText(row, 'user', 'name', 'email') || firstText(row, 'studentName', 'name', 'email') || t('Applicant unavailable')
  if (kind === 'listings') return firstText(row, 'title') || t('Listing title unavailable')
  if (kind === 'reviews') return firstText(row, 'title', 'content', 'comment', 'body') || t('Review content unavailable')
  return firstText(row, 'reason', 'description', 'category') || t('Report details unavailable')
}

function rowDetail(row: DataRecord, kind: ModerationKind): string {
  if (kind === 'accounts') return firstText(row, 'email') || (Array.isArray(row.roles) ? row.roles.filter((role): role is string => typeof role === 'string').join(', ') : '')
  if (kind === 'landlord-verifications') return nestedText(row, 'landlord', 'email') || firstText(row, 'kind')
  if (kind === 'property-authorizations') return firstText(row, 'addressSnapshot') || nestedText(row, 'listing', 'address')
  if (kind === 'verifications') return firstText(row, 'university', 'verificationMethod', 'emailDomain') || nestedText(row, 'student', 'email') || nestedText(row, 'user', 'email')
  if (kind === 'listings') return nestedText(row, 'owner', 'name', 'email') || firstText(row, 'approximateArea', 'campusName', 'ownerName')
  if (kind === 'reviews') return nestedText(row, 'listing', 'title') || nestedText(row, 'author', 'name') || firstText(row, 'listingId')
  return nestedText(row, 'reporter', 'name', 'email') || firstText(row, 'targetType', 'targetId')
}

function auditInfo(row: DataRecord, t: Translate) {
  const moderator = nestedText(row, 'moderatedBy', 'name', 'email') || nestedText(row, 'reviewedBy', 'name', 'email') || firstText(row, 'moderatorName', 'reviewerName')
  const when = row.moderatedAt ?? row.reviewedAt ?? row.resolvedAt
  const reason = firstText(row, 'moderationReason', 'decisionReason', 'resolutionNote', 'adminReason')
  if (!moderator && !when && !reason) return null
  return [moderator && t('Reviewed by: {name}', { name: moderator }), when && t('Reviewed at: {date}', { date: dateText(when) }), reason && t('Note: {reason}', { reason })].filter(Boolean).join(' · ')
}

function safeDocumentUrl(value: unknown): string | null {
  const source = typeof value === 'string' ? value.trim() : ''
  if (!source) return null
  try {
    const url = new URL(source, window.location.origin)
    return url.protocol === 'https:' || url.origin === window.location.origin ? url.href : null
  } catch {
    return null
  }
}

function privateVerificationUrl(row: DataRecord, field: 'studentIdUrl' | 'offerLetterUrl', document: 'student-id' | 'offer-letter'): string | null {
  const id = firstText(row, 'id')
  const source = row[field]
  if (!id || typeof source !== 'string') return null
  try {
    const url = new URL(source, window.location.origin)
    const expected = `/api/v1/admin/verifications/${encodeURIComponent(id)}/${document}`
    return url.origin === window.location.origin && url.pathname === expected && !url.search && !url.hash
      ? apiResourceUrl(`/admin/verifications/${encodeURIComponent(id)}/${document}`) : null
  } catch {
    return null
  }
}

function privateLandlordDocumentUrl(row: DataRecord, kind: 'landlord-verifications' | 'property-authorizations', field: 'identityUrl' | 'companyUrl' | 'representativeUrl' | 'proofUrl' | 'supportingUrl', document: 'identity' | 'company' | 'representative' | 'proof' | 'supporting'): string | null {
  const id = firstText(row, 'id')
  const source = row[field]
  if (!id || typeof source !== 'string') return null
  try {
    const url = new URL(source, window.location.origin)
    const expected = `/api/v1/admin/${kind}/${encodeURIComponent(id)}/${document}`
    return url.origin === window.location.origin && url.pathname === expected && !url.search && !url.hash
      ? apiResourceUrl(`/admin/${kind}/${encodeURIComponent(id)}/${document}`) : null
  } catch { return null }
}

function ModerationDetails({ kind, row }: { kind: ModerationKind; row: DataRecord }) {
  const { t } = useI18n()
  const details: Array<{ label: string; value: string }> = []
  if (kind === 'accounts') {
    details.push(
      { label: 'Name', value: firstText(row, 'name', 'displayName') },
      { label: 'Email', value: firstText(row, 'email') },
      { label: 'Roles', value: Array.isArray(row.roles) ? row.roles.filter((role): role is string => typeof role === 'string').map(role => t(role)).join(', ') : t(firstText(row, 'role')) },
      { label: 'Email verification', value: typeof row.emailVerified === 'boolean' ? t(row.emailVerified ? 'Verified' : 'Unverified') : '' },
    )
  } else if (kind === 'verifications') {
    const emailVerified = asRecord(row.student)?.emailVerified ?? row.emailVerified
    details.push(
      { label: 'Applicant', value: nestedText(row, 'student', 'name', 'email') || nestedText(row, 'user', 'name', 'email') || firstText(row, 'name', 'email') },
      { label: 'Email', value: nestedText(row, 'student', 'email') || nestedText(row, 'user', 'email') || firstText(row, 'email') },
      { label: 'Email verification', value: typeof emailVerified === 'boolean' ? t(emailVerified ? 'Verified' : 'Unverified') : '' },
      { label: 'University', value: firstText(row, 'university', 'universityName') },
      { label: 'Verification method', value: t(firstText(row, 'verificationMethod', 'method')) },
      { label: 'Official enrollment check', value: t(({ ACTIVE: 'Active enrollment confirmed', INACTIVE: 'University record says inactive', INCONCLUSIVE: 'Official check inconclusive', NOT_CHECKED: 'No official enrollment check' } as Record<string, string>)[firstText(row, 'enrollmentCheckStatus')] || 'No official enrollment check') },
      { label: 'Official source reference', value: firstText(row, 'enrollmentCheckReference') },
      { label: 'Official check recorded at', value: row.enrollmentCheckedAt ? dateText(row.enrollmentCheckedAt) : '' },
      { label: 'Study end date (offer letter)', value: firstText(row, 'studyEndsAt').slice(0, 10) || (firstText(row, 'status') === 'APPROVED' ? t('Not recorded') : '') },
      { label: 'Evidence retention deadline', value: firstText(row, 'evidenceRetainUntil').slice(0, 10) || (firstText(row, 'status') === 'APPROVED' ? t('Not recorded') : '') },
    )
  } else if (kind === 'landlord-verifications') {
    const emailVerified = asRecord(row.landlord)?.emailVerified
    details.push(
      { label: 'Applicant', value: nestedText(row, 'landlord', 'name', 'email') },
      { label: 'Email', value: nestedText(row, 'landlord', 'email') },
      { label: 'Phone Number', value: nestedText(row, 'landlord', 'phone') },
      { label: 'Email verification', value: typeof emailVerified === 'boolean' ? t(emailVerified ? 'Verified' : 'Unverified') : '' },
      { label: 'Account holder type', value: t(firstText(row, 'kind') === 'COMPANY' ? 'Company' : 'Individual') },
      { label: 'Valid until', value: row.expiresAt ? dateText(row.expiresAt) : '' },
      { label: 'Private review source/reference', value: firstText(row, 'reviewerSourceReference') },
      { label: 'Identity independently matched', value: row.reviewedAt ? t(row.identityMatched === true ? 'Confirmed' : 'Not recorded') : '' },
      { label: 'Company registry independently checked', value: row.reviewedAt && firstText(row, 'kind') === 'COMPANY' ? t(row.companyRegistryChecked === true ? 'Confirmed' : 'Not recorded') : '' },
    )
  } else if (kind === 'property-authorizations') {
    const right = firstText(row, 'kind')
    details.push(
      { label: 'Listing', value: nestedText(row, 'listing', 'title') },
      { label: 'Full Property Address', value: firstText(row, 'addressSnapshot') || nestedText(row, 'listing', 'address') },
      { label: 'Applicant', value: nestedText(row, 'landlord', 'name', 'email') },
      { label: 'Your right to offer this property', value: t(right === 'OWNER' ? 'Owner' : right === 'AGENT' ? 'Authorized agent' : 'Subletting tenant') },
      { label: 'Valid until', value: row.expiresAt ? dateText(row.expiresAt) : '' },
      { label: 'Private review source/reference', value: firstText(row, 'reviewerSourceReference') },
      { label: 'Right to rent independently checked', value: row.reviewedAt ? t(row.authorityChecked === true ? 'Confirmed' : 'Not recorded') : '' },
      { label: 'Evidence matched to this address', value: row.reviewedAt ? t(row.addressMatched === true ? 'Confirmed' : 'Not recorded') : '' },
    )
  } else if (kind === 'listings') {
    const rentalPolicy = firstText(row, 'genderPreference')
    details.push(
      { label: 'Title', value: firstText(row, 'title') },
      { label: 'Description', value: firstText(row, 'description') },
      { label: 'Monthly rent', value: firstText(row, 'rent', 'monthlyRent') },
      { label: 'Area', value: firstText(row, 'approximateArea', 'area', 'campusName') },
      { label: 'Rental eligibility', value: t(({ ALL: 'All genders welcome', MALE: 'Men only', FEMALE: 'Women only' } as Record<string, string>)[rentalPolicy] || 'All genders welcome') },
      { label: 'Owner', value: nestedText(row, 'owner', 'name', 'email') },
    )
  } else if (kind === 'reviews') {
    details.push(
      { label: 'Review', value: firstText(row, 'content', 'comment', 'body') },
      { label: 'Rating', value: firstText(row, 'rating') },
      { label: 'Listing', value: nestedText(row, 'listing', 'title') || firstText(row, 'listingId') },
      { label: 'Reviewer', value: nestedText(row, 'author', 'name', 'email') || nestedText(row, 'user', 'name', 'email') },
      { label: 'Rental experience', value: firstText(row, 'experienceDescription') },
      { label: 'Evidence status', value: t(firstText(row, 'experienceProofStatus', 'proofStatus')) },
    )
  } else {
    details.push(
      { label: 'Reason for report', value: firstText(row, 'reason', 'category') },
      { label: 'Details', value: firstText(row, 'description', 'details') },
      { label: 'Reported item', value: [firstText(row, 'targetType'), firstText(row, 'targetId')].filter(Boolean).join(' · ') },
      { label: 'Reported by', value: nestedText(row, 'reporter', 'name', 'email') },
    )
  }

  if (kind === 'landlord-verifications' || kind === 'property-authorizations') {
    const legal = asRecord(row.lawyerReview)
    details.push(
      { label: 'Assigned legal reviewer', value: firstText(legal, 'lawyerName') },
      { label: 'Legal recommendation', value: legal?.decision ? t(firstText(legal, 'decision')) : '' },
      { label: 'Private legal source/reference', value: firstText(legal, 'sourceReference') },
      { label: 'Private legal note', value: firstText(legal, 'reason') },
      { label: 'Legal recommendation submitted at', value: legal?.reviewedAt ? dateText(legal.reviewedAt) : '' },
    )
  }

  const photoSources = kind === 'listings' && Array.isArray(row.photos) ? row.photos : []
  const photos = photoSources.map(item => safeDocumentUrl(typeof item === 'string' ? item : asRecord(item)?.url)).filter((url): url is string => Boolean(url))
  const documentRequest = kind === 'verifications' && firstText(row, 'verificationMethod', 'method') === 'DOCUMENTS'
  const studentIdUrl = documentRequest ? privateVerificationUrl(row, 'studentIdUrl', 'student-id') : null
  const offerLetterUrl = documentRequest ? privateVerificationUrl(row, 'offerLetterUrl', 'offer-letter') : null
  const proofUrl = kind === 'reviews' || (kind === 'verifications' && !documentRequest) ? safeDocumentUrl(row.proofUrl ?? row.documentUrl ?? asRecord(row.document)?.url) : null
  const evidenceUrl = kind === 'reports' ? safeDocumentUrl(row.evidenceUrl) : null
  const landlordDocs = kind === 'landlord-verifications' ? [
    { field: 'identityUrl' as const, document: 'identity' as const, label: 'MyKad or passport photo' },
    { field: 'companyUrl' as const, document: 'company' as const, label: 'Company registration document' },
    { field: 'representativeUrl' as const, document: 'representative' as const, label: 'Representative authorization document' },
  ] : []
  const propertyDocs = kind === 'property-authorizations' ? [
    { field: 'proofUrl' as const, document: 'proof' as const, label: 'Primary property evidence' },
    { field: 'supportingUrl' as const, document: 'supporting' as const, label: 'Supporting authorization evidence' },
  ] : []

  return (
    <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-900">{t('Review details')}</h3>
      {(kind === 'verifications' || kind === 'landlord-verifications' || kind === 'property-authorizations') && <div className="mt-3"><PreviewDocumentNotice reviewer /></div>}
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        {details.filter(item => item.value).map(item => <div key={item.label} className="min-w-0"><dt className="font-semibold text-slate-700">{t(item.label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{item.value}</dd></div>)}
      </dl>
      {photos.length > 0 && <div className="mt-4"><p className="text-sm font-semibold text-slate-700">{t('Listing photos')}</p><div className="mt-2 flex flex-wrap gap-2">{photos.map((url, index) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#203569]"><img src={url} alt={t('Listing photo {number}', { number: index + 1 })} className="h-24 w-32 rounded-lg border border-slate-200 object-cover" /></a>)}</div></div>}
      {documentRequest && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-700">{t('Student ID photo')}</p>{studentIdUrl ? <a href={studentIdUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-[#203569] underline">{t('Download student ID (review only)')}</a> : <p className="mt-2 text-sm text-red-700">{t('Document unavailable')}</p>}</div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-700">{t('Offer letter')}</p>{offerLetterUrl ? <a href={offerLetterUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-[#203569] underline">{t('Download offer letter (review only)')}</a> : <p className="mt-2 text-sm text-red-700">{t('Document unavailable')}</p>}</div>
      </div>}
      {(kind === 'landlord-verifications' || kind === 'property-authorizations') && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[...landlordDocs, ...propertyDocs].filter(item => typeof row[item.field] === 'string').map(item => {
          const url = privateLandlordDocumentUrl(row, kind, item.field, item.document)
          return <div key={item.field} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-700">{t(item.label)}</p>{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-[#203569] underline">{t('Open private document (review only)')}</a> : <p className="mt-2 text-sm text-red-700">{t('Document unavailable')}</p>}</div>
        })}
      </div>}
      {proofUrl && <p className="mt-4 text-sm"><a href={proofUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#203569] underline">{t(kind === 'reviews' ? 'View rental evidence (review only)' : 'View verification document (review only)')}</a></p>}
      {evidenceUrl && <p className="mt-4 text-sm"><a href={evidenceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#203569] underline">{t('View report evidence')}</a></p>}
    </div>
  )
}

function StudentStudyEndCorrection({ id, row }: { id: string; row: DataRecord }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [studyEndsAt, setStudyEndsAt] = useState(firstText(row, 'studyEndsAt').slice(0, 10))
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [validation, setValidation] = useState('')
  const [saved, setSaved] = useState(false)
  const correction = useMutation({
    mutationFn: () => api(`/admin/verifications/${encodeURIComponent(id)}/study-end`, {
      method: 'PATCH', body: JSON.stringify({ studyEndsAt, confirmOfferLetterDate: true, reason: reason.trim() }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'verifications'] })
      setReason('')
      setConfirmed(false)
      setValidation('')
      setSaved(true)
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(studyEndsAt) ? new Date(`${studyEndsAt}T00:00:00.000Z`) : null
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== studyEndsAt) {
      setValidation('Enter the valid study end date shown in the offer letter.')
      return
    }
    if (reason.trim().length < 10 || reason.trim().length > 500) {
      setValidation('Explain the date correction in 10 to 500 characters without copying document details.')
      return
    }
    if (!confirmed) {
      setValidation('Confirm that you checked the date against the original offer letter.')
      return
    }
    setValidation('')
    setSaved(false)
    correction.mutate()
  }

  return <form onSubmit={submit} noValidate className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
    <h3 className="font-semibold text-slate-900">{t('Correct or record the study end date')}</h3>
    <p className="mt-1 text-sm text-slate-700">{t('For an approved case, read the original offer letter before correcting or backfilling this date. A past date may make its private evidence eligible for a later manual cleanup run.')}</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="field"><label htmlFor={`correct-study-end-${id}`}>{t('Study end date (offer letter)')}</label><input id={`correct-study-end-${id}`} type="date" required value={studyEndsAt} onChange={event => setStudyEndsAt(event.currentTarget.value)} /></div>
      <div className="field"><label htmlFor={`correct-study-end-reason-${id}`}>{t('Correction reason (private audit record)')}</label><textarea id={`correct-study-end-reason-${id}`} value={reason} onChange={event => setReason(event.currentTarget.value)} rows={2} minLength={10} maxLength={500} required /></div>
    </div>
    <label className="mt-3 flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.currentTarget.checked)} className="mt-1" />{t('I checked this date against the original offer letter.')}</label>
    {(validation || correction.error) && <p role="alert" className="mt-3 text-sm text-red-700">{t(validation) || messageOf(correction.error)}</p>}
    {saved && <p role="status" className="mt-3 text-sm text-emerald-800">{t('The study end date and retention deadline were saved with an audit record.')}</p>}
    <button type="submit" disabled={correction.isPending} className="button mt-3">{t(correction.isPending ? 'Saving…' : 'Save corrected date')}</button>
  </form>
}

function EvidenceHoldControls({ id, kind, row }: { id: string; kind: 'verifications' | 'landlord-verifications' | 'property-authorizations'; row: DataRecord }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [confirmRelease, setConfirmRelease] = useState(false)
  const [validation, setValidation] = useState('')
  const [saved, setSaved] = useState(false)
  const held = Boolean(row.evidenceHoldAt)
  const caseKind = kind === 'verifications' ? 'student' : kind === 'landlord-verifications' ? 'identity' : 'property'
  const mutation = useMutation({
    mutationFn: () => api(`/admin/evidence-holds/${caseKind}/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ hold: !held, reason: reason.trim(), ...(held ? { confirmRelease: true } : {}) }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', kind] })
      setReason('')
      setConfirmRelease(false)
      setValidation('')
      setSaved(true)
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim().length < 10 || reason.trim().length > 500 || [...reason.trim()].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
      setValidation('Write a private reason of 10 to 500 characters without document details or line breaks.')
      return
    }
    if (held && !confirmRelease) {
      setValidation('Confirm that the dispute or preservation obligation has ended before releasing this hold.')
      return
    }
    setValidation('')
    setSaved(false)
    mutation.mutate()
  }

  return <form onSubmit={submit} noValidate className="mb-5 rounded-lg border border-amber-200 bg-white p-4">
    <h3 className="font-semibold text-slate-900">{t('Evidence preservation hold')}</h3>
    <p className="mt-1 text-sm text-slate-700">{t('A held case is excluded from document retention cleanup. Use a short private case reference; do not copy identity numbers or document contents.')}</p>
    <p className="mt-3 text-sm font-semibold text-slate-900">{t('Current hold status')}: {t(held ? 'On hold' : 'No hold')}</p>
    {held && <p className="mt-1 text-sm text-slate-700">{t('Placed at')}: {dateText(row.evidenceHoldAt)}</p>}
    {held && typeof row.evidenceHoldReason === 'string' && <p className="mt-1 break-words text-sm text-slate-700">{t('Private hold reason')}: {row.evidenceHoldReason}</p>}
    <div className="field mt-3"><label htmlFor={`evidence-hold-reason-${id}`}>{t(held ? 'Reason to release hold' : 'Reason to place hold')}</label><textarea id={`evidence-hold-reason-${id}`} rows={2} minLength={10} maxLength={500} required value={reason} onChange={event => setReason(event.currentTarget.value)} /></div>
    {held && <label className="mt-3 flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" checked={confirmRelease} onChange={event => setConfirmRelease(event.currentTarget.checked)} className="mt-1" />{t('I confirmed the dispute or preservation obligation has ended.')}</label>}
    {(validation || mutation.error) && <p role="alert" className="mt-3 text-sm text-red-700">{validation ? t(validation) : messageOf(mutation.error)}</p>}
    {saved && <p role="status" className="mt-3 text-sm text-emerald-800">{t('Evidence hold change saved with an audit record.')}</p>}
    <button type="submit" disabled={mutation.isPending} className="button mt-3">{t(mutation.isPending ? 'Saving…' : held ? 'Release hold' : 'Place hold')}</button>
  </form>
}

export function AdminModerationPage({ kind }: { kind: ModerationKind }) {
  const { t } = useI18n()
  const config = configuration[kind]
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [decision, setDecision] = useState(config.approve)
  const [reason, setReason] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [studentIdMatchesEmail, setStudentIdMatchesEmail] = useState(false)
  const [studyEndsAt, setStudyEndsAt] = useState('')
  const [enrollmentCheckStatus, setEnrollmentCheckStatus] = useState('NOT_CHECKED')
  const [enrollmentCheckReference, setEnrollmentCheckReference] = useState('')
  const [acknowledgeLegalReview, setAcknowledgeLegalReview] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [validation, setValidation] = useState<string | null>(null)

  const search = new URLSearchParams({ page: String(page) })
  if (status) search.set('status', status)
  const list = useQuery({
    queryKey: ['admin', kind, page, status],
    queryFn: () => api<unknown>(`/admin/${kind}?${search}`),
  })
  const rows = rowsOf(list.data, kind)
  const pages = pageCount(list.data)
  const detail = useQuery({
    queryKey: ['admin', kind, 'detail', selectedId],
    queryFn: () => api<unknown>(`/admin/${kind}/${encodeURIComponent(selectedId || '')}`),
    enabled: Boolean(selectedId) && kind !== 'accounts',
  })

  const mutation = useMutation({
    mutationFn: ({ id, nextStatus, explanation, expiry, idMatchesEmail, studyEndDate, enrollmentStatus, enrollmentReference, legalAcknowledged }: { id: string; nextStatus: string; explanation: string; expiry: string; idMatchesEmail: boolean; studyEndDate: string; enrollmentStatus: string; enrollmentReference: string; legalAcknowledged: boolean }) =>
      api<unknown>(`/admin/${kind}/${encodeURIComponent(id)}`, {
        method: 'PATCH', body: JSON.stringify({ status: nextStatus, reason: explanation, ...(expiry && nextStatus === 'APPROVED' ? { validUntil: expiry } : {}), ...(kind === 'verifications' && nextStatus === 'APPROVED' ? { studentIdMatchesEmail: idMatchesEmail, studyEndsAt: studyEndDate } : {}), ...(kind === 'verifications' && enrollmentStatus !== 'NOT_CHECKED' ? { enrollmentCheckStatus: enrollmentStatus, enrollmentCheckReference: enrollmentReference } : {}),
          ...(nextStatus === 'APPROVED' && (kind === 'landlord-verifications' || kind === 'property-authorizations') ? { acknowledgeLegalReview: legalAcknowledged } : {}),
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', kind] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
      ])
      setNotice(t('Decision saved for this {item}.', { item: t(config.singular) }))
      setSelectedId(null)
      setReason('')
      setValidUntil('')
      setStudentIdMatchesEmail(false)
      setStudyEndsAt('')
      setEnrollmentCheckStatus('NOT_CHECKED')
      setEnrollmentCheckReference('')
      setAcknowledgeLegalReview(false)
      setValidation(null)
    },
  })

  function openForm(id: string, currentStatus: string) {
    if (selectedId === id) { setSelectedId(null); return }
    setSelectedId(id)
    setDecision(kind === 'accounts' && currentStatus === 'ACTIVE' ? config.reject : kind === 'listings' && currentStatus === 'PUBLISHED' ? 'PAUSED' : (kind === 'landlord-verifications' || kind === 'property-authorizations') && currentStatus === 'APPROVED' ? 'REVOKED' : config.approve)
    setReason('')
    setValidUntil('')
    setStudentIdMatchesEmail(false)
    setStudyEndsAt('')
    setEnrollmentCheckStatus('NOT_CHECKED')
    setEnrollmentCheckReference('')
    setAcknowledgeLegalReview(false)
    setValidation(null)
    setNotice(null)
    mutation.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const explanation = reason.trim()
    const selectedVerification = kind === 'verifications' ? asRecord(detail.data) : null
    if (decision === config.approve && selectedVerification && firstText(selectedVerification, 'verificationMethod', 'method') === 'DOCUMENTS' &&
      (!privateVerificationUrl(selectedVerification, 'studentIdUrl', 'student-id') || !privateVerificationUrl(selectedVerification, 'offerLetterUrl', 'offer-letter'))) {
      setValidation('Both student documents must be available before approval.')
      return
    }
    if (kind === 'verifications' && decision === 'APPROVED' && !studentIdMatchesEmail) {
      setValidation('Confirm that the Student ID on the card matches the school email before approval.')
      return
    }
    if (kind === 'verifications' && decision === 'APPROVED') {
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(studyEndsAt) ? new Date(`${studyEndsAt}T00:00:00.000Z`) : null
      if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== studyEndsAt) {
        setValidation('Enter the valid study end date shown in the offer letter before approval.')
        return
      }
    }
    if (kind === 'verifications' && enrollmentCheckStatus !== 'NOT_CHECKED' && enrollmentCheckReference.trim().length < 4) {
      setValidation('Enter an official source reference of at least 4 characters.')
      return
    }
    if (kind === 'verifications' && decision === 'APPROVED' && enrollmentCheckStatus === 'INACTIVE') {
      setValidation('Do not approve a student whose authorized university record says enrollment is inactive.')
      return
    }
    const reviewed = asRecord(detail.data)
    if (decision === config.approve && kind === 'landlord-verifications' && reviewed &&
      (!privateLandlordDocumentUrl(reviewed, kind, 'identityUrl', 'identity') || (firstText(reviewed, 'kind') === 'COMPANY' && (!privateLandlordDocumentUrl(reviewed, kind, 'companyUrl', 'company') || !privateLandlordDocumentUrl(reviewed, kind, 'representativeUrl', 'representative'))))) {
      setValidation('Required landlord identity documents must be available before approval.')
      return
    }
    if (decision === config.approve && kind === 'property-authorizations' && reviewed &&
      (!privateLandlordDocumentUrl(reviewed, kind, 'proofUrl', 'proof') || (firstText(reviewed, 'kind') !== 'OWNER' && !privateLandlordDocumentUrl(reviewed, kind, 'supportingUrl', 'supporting')))) {
      setValidation('Required property authorization documents must be available before approval.')
      return
    }
    if (decision === config.approve && (kind === 'landlord-verifications' || kind === 'property-authorizations')) {
      if (reviewed?.lawyerReviewRequired === true && firstText(asRecord(reviewed.lawyerReview), 'decision') !== 'APPROVE') { setValidation('A legal reviewer must recommend approval before an administrator can approve this case.'); return }
      if (reviewed?.lawyerReviewRequired === true && !acknowledgeLegalReview) { setValidation('Confirm you reviewed the legal recommendation before the final decision.'); return }
    }
    if ((decision === config.reject || decision === config.extraAction?.value || kind === 'reports') && explanation.length < 3) {
      setValidation('Please enter a reason of at least 3 characters.')
      return
    }
    if (explanation.length > 1000) {
      setValidation('The reason must be 1,000 characters or fewer.')
      return
    }
    if (!selectedId) return
    setValidation(null)
    mutation.mutate({ id: selectedId, nextStatus: decision, explanation, expiry: validUntil, idMatchesEmail: studentIdMatchesEmail, studyEndDate: studyEndsAt, enrollmentStatus: enrollmentCheckStatus, enrollmentReference: enrollmentCheckReference.trim(), legalAcknowledged: acknowledgeLegalReview })
  }

  return (
    <AdminShell title={config.title} description={config.description}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="field min-w-48">
          <label htmlFor={`admin-status-${kind}`}>{t('Filter by status')}</label>
          <select id={`admin-status-${kind}`} value={status} onChange={event => { setStatus(event.target.value); setPage(1); setSelectedId(null) }}>
            <option value="">{t('All statuses')}</option>
            {config.statuses.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
          </select>
        </div>
        <button type="button" className="button button-secondary" onClick={() => { void list.refetch() }} disabled={list.isFetching}>{t('Refresh queue')}</button>
      </div>
      <div className="mb-4"><Notice success={notice} error={validation || (mutation.error ? messageOf(mutation.error) : null)} /></div>
      <QueryState loading={list.isPending} error={list.error ? messageOf(list.error) : null} empty={rows.length === 0} emptyText={t('No {items} match the current filter.', { items: t({ verifications: 'verification requests', 'landlord-verifications': 'landlord identity requests', 'property-authorizations': 'property authorization requests', listings: 'listings', reviews: 'reviews', reports: 'reports', accounts: 'accounts' }[kind]) })} onRetry={() => { void list.refetch() }} />
      {!list.isPending && !list.error && rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <caption className="sr-only">{t('{title} queue', { title: t(config.title) })}</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
              <tr><th scope="col" className="px-4 py-3">{t('Content')}</th><th scope="col" className="px-4 py-3">{t('Status')}</th><th scope="col" className="px-4 py-3">{t('Submitted')}</th><th scope="col" className="px-4 py-3">{t('Review history')}</th><th scope="col" className="px-4 py-3">{t('Actions')}</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const id = firstText(row, 'id')
                const currentStatus = firstText(row, 'status')
                const audit = auditInfo(row, t)
                const lifecycleReview = kind === 'landlord-verifications' || kind === 'property-authorizations'
                const canDecide = kind === 'verifications' ? currentStatus === 'PENDING' : !lifecycleReview || currentStatus === 'PENDING' || currentStatus === 'APPROVED'
                return (
                  <FragmentRow key={id || index}>
                    <tr className="border-b border-slate-100 align-top">
                      <td className="max-w-xs px-4 py-4">
                        <strong className="block break-words text-slate-900">{rowTitle(row, kind, t)}</strong>
                        {rowDetail(row, kind) && <span className="mt-1 block break-words text-slate-600">{rowDetail(row, kind)}</span>}
                        {id && <span className="mt-1 block text-xs text-slate-500">ID: {id}</span>}
                      </td>
                      <td className="px-4 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-800">{t(statusLabels[currentStatus] || currentStatus || 'Status unavailable')}</span></td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-700">{dateText(row.submittedAt ?? row.createdAt)}</td>
                      <td className="max-w-xs px-4 py-4 text-slate-600">{audit || t('No review history yet')}</td>
                      <td className="px-4 py-4">
                        <button type="button" className="button button-secondary button-small" disabled={!id || mutation.isPending} aria-expanded={selectedId === id} onClick={() => openForm(id, currentStatus)}>{t(selectedId === id ? 'Close' : 'Review')}</button>
                      </td>
                    </tr>
                    {id && selectedId === id && (
                      <tr className="border-b border-slate-200 bg-[#f2f5fc]"><td colSpan={5} className="px-4 py-5">
                        {kind === 'accounts' ? <ModerationDetails kind={kind} row={row} /> : <>
                          <QueryState loading={detail.isPending} error={detail.error ? messageOf(detail.error) : null} empty={!asRecord(detail.data)} emptyText="The server did not provide details for this record." onRetry={() => { void detail.refetch() }} />
                          {asRecord(detail.data) && !detail.error && <>
                            <ModerationDetails kind={kind} row={asRecord(detail.data)!} />
                            {(kind === 'verifications' || kind === 'landlord-verifications' || kind === 'property-authorizations') && <EvidenceHoldControls key={`${kind}-${id}`} id={id} kind={kind} row={asRecord(detail.data)!} />}
                            {kind === 'verifications' && currentStatus === 'APPROVED' && firstText(asRecord(detail.data), 'verificationMethod', 'method') === 'DOCUMENTS' && privateVerificationUrl(asRecord(detail.data)!, 'offerLetterUrl', 'offer-letter') && <StudentStudyEndCorrection key={id} id={id} row={asRecord(detail.data)!} />}
                          </>}
                        </>}
                        {canDecide ? <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:items-end">
                          <div className="field">
                            <label htmlFor={`decision-${kind}-${id}`}>{t('Decision')}</label>
                            <select id={`decision-${kind}-${id}`} value={decision} onChange={event => { setDecision(event.target.value); setValidation(null) }}>
                              {(!lifecycleReview || currentStatus === 'PENDING') && <option value={config.approve}>{t(config.approveLabel)}</option>}
                              {(!lifecycleReview || currentStatus === 'PENDING') && <option value={config.reject}>{t(config.rejectLabel)}</option>}
                              {config.extraAction && (!lifecycleReview || currentStatus === 'APPROVED') && <option value={config.extraAction.value}>{t(config.extraAction.label)}</option>}
                            </select>
                          </div>
                          {!(lifecycleReview && decision === config.approve) && <div className="field">
                            <label htmlFor={`reason-${kind}-${id}`}>{t(lifecycleReview ? 'Reason shown to applicant' : 'Reason')}{t(decision === config.reject || decision === config.extraAction?.value || kind === 'reports' ? ' (required)' : ' (optional)')}</label>
                            <textarea id={`reason-${kind}-${id}`} rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} required={decision === config.reject || decision === config.extraAction?.value || kind === 'reports'} placeholder={t(lifecycleReview ? 'Explain the decision without including private document details' : 'Record your review findings and explain any rejection or suspension')} />
                          </div>}
                          {lifecycleReview && decision === config.approve && <div className="field md:col-span-3"><label htmlFor={`valid-until-${kind}-${id}`}>{t('Valid until (optional, Malaysia time)')}</label><input id={`valid-until-${kind}-${id}`} type="date" value={validUntil} onChange={event => setValidUntil(event.currentTarget.value)} /><p className="mt-1 text-xs text-slate-600">{t('Leave blank to use the configured maximum. Choose an earlier date if the supporting document expires sooner.')}</p></div>}
                          {lifecycleReview && decision === config.approve && <>
                            {asRecord(detail.data)?.lawyerReviewRequired === true && <div className="md:col-span-3">
                              {firstText(asRecord(asRecord(detail.data)?.lawyerReview), 'decision') === 'APPROVE'
                                ? <label className="flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" checked={acknowledgeLegalReview} onChange={event => setAcknowledgeLegalReview(event.target.checked)} className="mt-1" /><span>{t('I reviewed the assigned lawyer’s recommendation and evidence before this final decision.')}</span></label>
                                : <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{t('A legal reviewer must recommend approval before an administrator can approve this case.')} <Link to="/admin/lawyer-cases" className="font-semibold underline">{t('Open legal reviewer assignments')}</Link></p>}
                            </div>}
                          </>}
                          {kind === 'verifications' && decision === 'APPROVED' && <label className="flex items-start gap-2 text-sm text-slate-800 md:col-span-3"><input type="checkbox" checked={studentIdMatchesEmail} onChange={event => setStudentIdMatchesEmail(event.target.checked)} className="mt-1" /><span>{t('I compared the Student ID on the card with the part of the school email before @.')}</span></label>}
                          {kind === 'verifications' && decision === 'APPROVED' && <div className="field md:col-span-3"><label htmlFor={`study-end-${id}`}>{t('Study end date (offer letter)')}</label><input id={`study-end-${id}`} type="date" required value={studyEndsAt} onChange={event => setStudyEndsAt(event.currentTarget.value)} /><p className="mt-1 text-xs text-slate-600">{t('Read the study end date from the offer letter. Do not estimate it from the program length. If the letter has no end date, ask for an official document confirming the date. Student verification files are kept until one calendar year after that date.')}</p></div>}
                          {kind === 'verifications' && <div className="field md:col-span-3"><label htmlFor={`enrollment-check-${id}`}>{t('Official enrollment check')}</label><select id={`enrollment-check-${id}`} value={enrollmentCheckStatus} onChange={event => { setEnrollmentCheckStatus(event.currentTarget.value); setEnrollmentCheckReference(''); setValidation(null) }}><option value="NOT_CHECKED">{t('No official enrollment check')}</option><option value="ACTIVE">{t('Active enrollment confirmed')}</option><option value="INACTIVE">{t('University record says inactive')}</option><option value="INCONCLUSIVE">{t('Official check inconclusive')}</option></select><p className="mt-1 text-xs text-slate-600">{t('Choose a checked result only if you have authorized access to a university record. Document review alone is not an official enrollment check.')}</p></div>}
                          {kind === 'verifications' && enrollmentCheckStatus !== 'NOT_CHECKED' && <div className="field md:col-span-3"><label htmlFor={`enrollment-reference-${id}`}>{t('Official source reference')}</label><input id={`enrollment-reference-${id}`} type="text" minLength={4} maxLength={120} required autoComplete="off" value={enrollmentCheckReference} onChange={event => setEnrollmentCheckReference(event.currentTarget.value)} /><p className="mt-1 text-xs text-slate-600">{t('Record a case or query reference, not the student ID or document contents.')}</p></div>}
                          <button type="submit" className="button" disabled={mutation.isPending || (['verifications', 'landlord-verifications', 'property-authorizations'].includes(kind) && (detail.isPending || detail.isError))}>{t(mutation.isPending ? 'Saving…' : 'Save decision')}</button>
                        </form> : <p className="mt-4 text-sm text-slate-600">{t(kind === 'verifications' ? 'This verification has already been decided.' : 'This approval is no longer active. The applicant must submit a new request.')}</p>}
                      </td></tr>
                    )}
                  </FragmentRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages !== null && pages > 1 && !list.error && (
        <nav aria-label={t('Review queue pagination')} className="mt-5 flex items-center justify-end gap-3">
          <button type="button" className="button button-secondary button-small" disabled={page <= 1 || list.isFetching} onClick={() => { setPage(value => value - 1); setSelectedId(null) }}>{t('Previous')}</button>
          <span className="text-sm text-slate-700">{t('Page {page} of {pages}', { page, pages })}</span>
          <button type="button" className="button button-secondary button-small" disabled={page >= pages || list.isFetching} onClick={() => { setPage(value => value + 1); setSelectedId(null) }}>{t('Next')}</button>
        </nav>
      )}
      <p className="mt-4 text-xs text-slate-500">{t('Decisions and audit records are based on data saved by the server.')}</p>
    </AdminShell>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
