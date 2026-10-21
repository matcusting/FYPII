import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, itemsOf, messageOf } from '../../lib/api'
import { AdminShell, Notice, QueryState } from './shared'
import { asRecord, dateText, firstText, nestedText, type DataRecord } from './data'

type ModerationKind = 'verifications' | 'listings' | 'reviews' | 'reports' | 'accounts'

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

function rowTitle(row: DataRecord, kind: ModerationKind): string {
  if (kind === 'accounts') return firstText(row, 'name', 'displayName', 'email') || 'Account name unavailable'
  if (kind === 'verifications') return nestedText(row, 'student', 'name', 'email') || nestedText(row, 'user', 'name', 'email') || firstText(row, 'studentName', 'name', 'email') || 'Applicant unavailable'
  if (kind === 'listings') return firstText(row, 'title') || 'Listing title unavailable'
  if (kind === 'reviews') return firstText(row, 'title', 'content', 'comment', 'body') || 'Review content unavailable'
  return firstText(row, 'reason', 'description', 'category') || 'Report details unavailable'
}

function rowDetail(row: DataRecord, kind: ModerationKind): string {
  if (kind === 'accounts') return firstText(row, 'email') || (Array.isArray(row.roles) ? row.roles.filter((role): role is string => typeof role === 'string').join(', ') : '')
  if (kind === 'verifications') return firstText(row, 'university', 'verificationMethod', 'emailDomain') || nestedText(row, 'student', 'email') || nestedText(row, 'user', 'email')
  if (kind === 'listings') return nestedText(row, 'owner', 'name', 'email') || firstText(row, 'approximateArea', 'campusName', 'ownerName')
  if (kind === 'reviews') return nestedText(row, 'listing', 'title') || nestedText(row, 'author', 'name') || firstText(row, 'listingId')
  return nestedText(row, 'reporter', 'name', 'email') || firstText(row, 'targetType', 'targetId')
}

function auditInfo(row: DataRecord) {
  const moderator = nestedText(row, 'moderatedBy', 'name', 'email') || nestedText(row, 'reviewedBy', 'name', 'email') || firstText(row, 'moderatorName', 'reviewerName')
  const when = row.moderatedAt ?? row.reviewedAt ?? row.resolvedAt
  const reason = firstText(row, 'moderationReason', 'decisionReason', 'resolutionNote', 'adminReason')
  if (!moderator && !when && !reason) return null
  return [moderator && `Reviewed by: ${moderator}`, when && `Reviewed at: ${dateText(when)}`, reason && `Note: ${reason}`].filter(Boolean).join(' · ')
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

function ModerationDetails({ kind, row }: { kind: ModerationKind; row: DataRecord }) {
  const details: Array<{ label: string; value: string }> = []
  if (kind === 'accounts') {
    details.push(
      { label: 'Name', value: firstText(row, 'name', 'displayName') },
      { label: 'Email', value: firstText(row, 'email') },
      { label: 'Roles', value: Array.isArray(row.roles) ? row.roles.filter((role): role is string => typeof role === 'string').join(', ') : firstText(row, 'role') },
      { label: 'Email verification', value: typeof row.emailVerified === 'boolean' ? row.emailVerified ? 'Verified' : 'Unverified' : '' },
    )
  } else if (kind === 'verifications') {
    details.push(
      { label: 'Applicant', value: nestedText(row, 'student', 'name', 'email') || nestedText(row, 'user', 'name', 'email') || firstText(row, 'name', 'email') },
      { label: 'Email', value: nestedText(row, 'student', 'email') || nestedText(row, 'user', 'email') || firstText(row, 'email') },
      { label: 'University', value: firstText(row, 'university', 'universityName') },
      { label: 'Verification method', value: firstText(row, 'verificationMethod', 'method') },
    )
  } else if (kind === 'listings') {
    details.push(
      { label: 'Title', value: firstText(row, 'title') },
      { label: 'Description', value: firstText(row, 'description') },
      { label: 'Monthly rent', value: firstText(row, 'rent', 'monthlyRent') },
      { label: 'Area', value: firstText(row, 'approximateArea', 'area', 'campusName') },
      { label: 'Owner', value: nestedText(row, 'owner', 'name', 'email') },
    )
  } else if (kind === 'reviews') {
    details.push(
      { label: 'Review', value: firstText(row, 'content', 'comment', 'body') },
      { label: 'Rating', value: firstText(row, 'rating') },
      { label: 'Listing', value: nestedText(row, 'listing', 'title') || firstText(row, 'listingId') },
      { label: 'Reviewer', value: nestedText(row, 'author', 'name', 'email') || nestedText(row, 'user', 'name', 'email') },
    )
  } else {
    details.push(
      { label: 'Reason for report', value: firstText(row, 'reason', 'category') },
      { label: 'Details', value: firstText(row, 'description', 'details') },
      { label: 'Reported item', value: [firstText(row, 'targetType'), firstText(row, 'targetId')].filter(Boolean).join(' · ') },
      { label: 'Reported by', value: nestedText(row, 'reporter', 'name', 'email') },
    )
  }

  const photoSources = kind === 'listings' && Array.isArray(row.photos) ? row.photos : []
  const photos = photoSources.map(item => safeDocumentUrl(typeof item === 'string' ? item : asRecord(item)?.url)).filter((url): url is string => Boolean(url))
  const proofUrl = kind === 'verifications' ? safeDocumentUrl(row.documentUrl ?? row.proofUrl ?? asRecord(row.document)?.url) : null
  const evidenceUrl = kind === 'reports' ? safeDocumentUrl(row.evidenceUrl) : null

  return (
    <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-900">Review details</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        {details.filter(item => item.value).map(item => <div key={item.label} className="min-w-0"><dt className="font-semibold text-slate-700">{item.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-900">{item.value}</dd></div>)}
      </dl>
      {photos.length > 0 && <div className="mt-4"><p className="text-sm font-semibold text-slate-700">Listing photos</p><div className="mt-2 flex flex-wrap gap-2">{photos.map((url, index) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#203569]"><img src={url} alt={`Listing photo ${index + 1}`} className="h-24 w-32 rounded-lg border border-slate-200 object-cover" /></a>)}</div></div>}
      {proofUrl && <p className="mt-4 text-sm"><a href={proofUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#203569] underline">View verification document (review only)</a></p>}
      {evidenceUrl && <p className="mt-4 text-sm"><a href={evidenceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#203569] underline">View report evidence</a></p>}
    </div>
  )
}

export function AdminModerationPage({ kind }: { kind: ModerationKind }) {
  const config = configuration[kind]
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [decision, setDecision] = useState(config.approve)
  const [reason, setReason] = useState('')
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
    mutationFn: ({ id, nextStatus, explanation }: { id: string; nextStatus: string; explanation: string }) =>
      api<unknown>(`/admin/${kind}/${encodeURIComponent(id)}`, {
        method: 'PATCH', body: JSON.stringify({ status: nextStatus, reason: explanation }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', kind] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
      ])
      setNotice(`Decision saved for this ${config.singular}.`)
      setSelectedId(null)
      setReason('')
      setValidation(null)
    },
  })

  function openForm(id: string, currentStatus: string) {
    if (selectedId === id) { setSelectedId(null); return }
    setSelectedId(id)
    setDecision(kind === 'accounts' && currentStatus === 'ACTIVE' ? config.reject : kind === 'listings' && currentStatus === 'PUBLISHED' ? 'PAUSED' : config.approve)
    setReason('')
    setValidation(null)
    setNotice(null)
    mutation.reset()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const explanation = reason.trim()
    if ((decision === config.reject || decision === config.extraAction?.value || kind === 'reports') && explanation.length < 3) {
      setValidation('Please enter a reason of at least 3 characters.')
      return
    }
    if (!selectedId) return
    setValidation(null)
    mutation.mutate({ id: selectedId, nextStatus: decision, explanation })
  }

  return (
    <AdminShell title={config.title} description={config.description}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="field min-w-48">
          <label htmlFor={`admin-status-${kind}`}>Filter by status</label>
          <select id={`admin-status-${kind}`} value={status} onChange={event => { setStatus(event.target.value); setPage(1); setSelectedId(null) }}>
            <option value="">All statuses</option>
            {config.statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <button type="button" className="button button-secondary" onClick={() => { void list.refetch() }} disabled={list.isFetching}>Refresh queue</button>
      </div>
      <div className="mb-4"><Notice success={notice} error={validation || (mutation.error ? messageOf(mutation.error) : null)} /></div>
      <QueryState loading={list.isPending} error={list.error ? messageOf(list.error) : null} empty={rows.length === 0} emptyText={`No ${config.singular}s match the current filter.`} onRetry={() => { void list.refetch() }} />
      {!list.isPending && !list.error && rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <caption className="sr-only">{config.title} queue</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
              <tr><th scope="col" className="px-4 py-3">Content</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Submitted</th><th scope="col" className="px-4 py-3">Review history</th><th scope="col" className="px-4 py-3">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const id = firstText(row, 'id')
                const currentStatus = firstText(row, 'status')
                const audit = auditInfo(row)
                return (
                  <FragmentRow key={id || index}>
                    <tr className="border-b border-slate-100 align-top">
                      <td className="max-w-xs px-4 py-4">
                        <strong className="block break-words text-slate-900">{rowTitle(row, kind)}</strong>
                        {rowDetail(row, kind) && <span className="mt-1 block break-words text-slate-600">{rowDetail(row, kind)}</span>}
                        {id && <span className="mt-1 block text-xs text-slate-500">ID: {id}</span>}
                      </td>
                      <td className="px-4 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-800">{statusLabels[currentStatus] || currentStatus || 'Status unavailable'}</span></td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-700">{dateText(row.submittedAt ?? row.createdAt)}</td>
                      <td className="max-w-xs px-4 py-4 text-slate-600">{audit || 'No review history yet'}</td>
                      <td className="px-4 py-4">
                        <button type="button" className="button button-secondary button-small" disabled={!id || mutation.isPending} aria-expanded={selectedId === id} onClick={() => openForm(id, currentStatus)}>{selectedId === id ? 'Close' : 'Review'}</button>
                      </td>
                    </tr>
                    {id && selectedId === id && (
                      <tr className="border-b border-slate-200 bg-[#f2f5fc]"><td colSpan={5} className="px-4 py-5">
                        {kind === 'accounts' ? <ModerationDetails kind={kind} row={row} /> : <>
                          <QueryState loading={detail.isPending} error={detail.error ? messageOf(detail.error) : null} empty={!asRecord(detail.data)} emptyText="The server did not provide details for this record." onRetry={() => { void detail.refetch() }} />
                          {asRecord(detail.data) && !detail.error && <ModerationDetails kind={kind} row={asRecord(detail.data)!} />}
                        </>}
                        <form onSubmit={submit} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:items-end">
                          <div className="field">
                            <label htmlFor={`decision-${kind}-${id}`}>Decision</label>
                            <select id={`decision-${kind}-${id}`} value={decision} onChange={event => { setDecision(event.target.value); setValidation(null) }}>
                              <option value={config.approve}>{config.approveLabel}</option>
                              <option value={config.reject}>{config.rejectLabel}</option>
                              {config.extraAction && <option value={config.extraAction.value}>{config.extraAction.label}</option>}
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor={`reason-${kind}-${id}`}>Reason{decision === config.reject || decision === config.extraAction?.value || kind === 'reports' ? ' (required)' : ' (optional)'}</label>
                            <textarea id={`reason-${kind}-${id}`} rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} required={decision === config.reject || decision === config.extraAction?.value || kind === 'reports'} placeholder="Record your review findings and explain any rejection or suspension" />
                          </div>
                          <button type="submit" className="button" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save decision'}</button>
                        </form>
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
        <nav aria-label="Review queue pagination" className="mt-5 flex items-center justify-end gap-3">
          <button type="button" className="button button-secondary button-small" disabled={page <= 1 || list.isFetching} onClick={() => { setPage(value => value - 1); setSelectedId(null) }}>Previous</button>
          <span className="text-sm text-slate-700">Page {page} of {pages}</span>
          <button type="button" className="button button-secondary button-small" disabled={page >= pages || list.isFetching} onClick={() => { setPage(value => value + 1); setSelectedId(null) }}>Next</button>
        </nav>
      )}
      <p className="mt-4 text-xs text-slate-500">Decisions and audit records are based on data saved by the server.</p>
    </AdminShell>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
