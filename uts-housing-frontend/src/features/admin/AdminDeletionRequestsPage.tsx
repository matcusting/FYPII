import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, itemsOf, messageOf } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { AdminShell, Notice, QueryState } from './shared'
import { asRecord, dateText, firstText, type DataRecord } from './data'

type Decision = 'APPROVED' | 'REJECTED'

export function AdminDeletionRequestsPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('PENDING')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [decision, setDecision] = useState<Decision>('REJECTED')
  const [reason, setReason] = useState('')
  const [confirmDeletion, setConfirmDeletion] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const path = `/admin/deletion-requests?${new URLSearchParams({ status, page: String(page) })}`
  const list = useQuery({ queryKey: ['admin', 'deletion-requests', status, page], queryFn: () => api<unknown>(path) })
  const data = asRecord(list.data)
  const rows = itemsOf<unknown>(list.data).map(asRecord).filter((row): row is DataRecord => row !== null)
  const pages = Math.max(1, Number(data?.pages) || 1)
  const mutation = useMutation({
    mutationFn: ({ id, result, explanation }: { id: string; result: Decision; explanation: string }) =>
      api(`/admin/deletion-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: result, reason: explanation }) }),
    onSuccess: async () => {
      setSelectedId(null)
      setReason('')
      setConfirmDeletion(false)
      setNotice('Decision saved.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'deletion-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
      ])
    },
  })

  function openReview(id: string) {
    setSelectedId(current => current === id ? null : id)
    setDecision('REJECTED')
    setReason('')
    setConfirmDeletion(false)
    setValidation(null)
    setNotice(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedId) return
    const explanation = reason.trim()
    if (explanation.length < 3 || explanation.length > 1000) {
      setValidation('Enter a reason between 3 and 1,000 characters.')
      return
    }
    if (decision === 'APPROVED' && !confirmDeletion) {
      setValidation('Confirm that you understand the account and verification documents will be removed.')
      return
    }
    setValidation(null)
    mutation.mutate({ id: selectedId, result: decision, explanation })
  }

  return <AdminShell title="Account Deletion Requests" description="Review account deletion requests and record a reason for each decision.">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="field min-w-48"><label htmlFor="deletion-status">{t('Filter by status')}</label>
        <select id="deletion-status" value={status} onChange={event => { setStatus(event.target.value); setPage(1); setSelectedId(null) }}>
          <option value="">{t('All statuses')}</option><option value="PENDING">{t('Pending review')}</option>
          <option value="APPROVED">{t('Approved')}</option><option value="REJECTED">{t('Rejected')}</option>
        </select>
      </div>
      <button type="button" className="button button-secondary" onClick={() => { void list.refetch() }} disabled={list.isFetching}>{t('Refresh queue')}</button>
    </div>
    <Notice success={notice} error={validation || (mutation.error ? messageOf(mutation.error) : null)} />
    <QueryState loading={list.isPending} error={list.error ? messageOf(list.error) : null} empty={rows.length === 0} emptyText={t('No account deletion requests match the current filter.')} onRetry={() => { void list.refetch() }} />
    {!list.isPending && !list.error && rows.length > 0 && <div className="card overflow-x-auto"><table className="w-full min-w-[700px] border-collapse text-left text-sm">
      <caption className="sr-only">{t('Account deletion requests')}</caption>
      <thead className="border-b border-slate-200 bg-slate-50 text-slate-700"><tr>
        <th scope="col" className="px-4 py-3">{t('Account')}</th><th scope="col" className="px-4 py-3">{t('Status')}</th>
        <th scope="col" className="px-4 py-3">{t('Submitted')}</th><th scope="col" className="px-4 py-3">{t('Actions')}</th>
      </tr></thead><tbody>{rows.map(row => {
        const id = firstText(row, 'id')
        const account = asRecord(row.user)
        const requestStatus = firstText(row, 'status')
        return <tr key={id} className="border-b border-slate-100 align-top"><td colSpan={4} className="p-0">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4">
            <div><strong className="block break-words text-slate-900">{firstText(account, 'name', 'email') || t('Account name unavailable')}</strong>
              <span className="block break-words text-slate-600">{firstText(account, 'email')}</span>
              <span className="text-xs text-slate-500">{Array.isArray(account?.roles) ? account.roles.filter((role): role is string => typeof role === 'string').map(role => t(role)).join(', ') : ''}</span></div>
            <span>{t(requestStatus === 'PENDING' ? 'Pending review' : requestStatus === 'APPROVED' ? 'Approved' : 'Rejected')}</span>
            <span>{dateText(row.requestedAt)}</span>
            <button type="button" className="button button-secondary button-small" aria-expanded={selectedId === id} onClick={() => openReview(id)}>{t(selectedId === id ? 'Close' : 'Review')}</button>
          </div>
          {selectedId === id && <div className="border-t border-slate-200 bg-[#f2f5fc] px-4 py-5">
            {requestStatus === 'PENDING' ? <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2"><div className="field"><label htmlFor={`deletion-decision-${id}`}>{t('Decision')}</label>
                <select id={`deletion-decision-${id}`} value={decision} onChange={event => { setDecision(event.target.value as Decision); setValidation(null) }}>
                  <option value="REJECTED">{t('Reject deletion')}</option><option value="APPROVED">{t('Approve deletion')}</option>
                </select></div>
                <div className="field"><label htmlFor={`deletion-reason-${id}`}>{t('Reason (required)')}</label>
                  <textarea id={`deletion-reason-${id}`} rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder={t('Record why you approved or rejected this request')} /></div></div>
              {decision === 'APPROVED' && <label className="flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" checked={confirmDeletion} onChange={event => setConfirmDeletion(event.target.checked)} className="mt-1" />
                <span>{t('I understand this will deactivate the account and remove its verification documents.')}</span></label>}
              <button type="submit" className="button" disabled={mutation.isPending}>{t(mutation.isPending ? 'Saving…' : 'Save decision')}</button>
            </form> : <p className="text-sm text-slate-600">{t('This request has already been reviewed.')}</p>}
          </div>}
        </td></tr>
      })}</tbody>
    </table></div>}
    {pages > 1 && !list.error && <nav aria-label={t('Review queue pagination')} className="mt-5 flex items-center justify-end gap-3">
      <button type="button" className="button button-secondary button-small" disabled={page <= 1 || list.isFetching} onClick={() => { setPage(value => value - 1); setSelectedId(null) }}>{t('Previous')}</button>
      <span className="text-sm text-slate-700">{t('Page {page} of {pages}', { page, pages })}</span>
      <button type="button" className="button button-secondary button-small" disabled={page >= pages || list.isFetching} onClick={() => { setPage(value => value + 1); setSelectedId(null) }}>{t('Next')}</button>
    </nav>}
  </AdminShell>
}
