import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, itemsOf, messageOf } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { AdminShell, QueryState } from './shared'
import { asRecord, dateText, firstText, type DataRecord } from './data'

export function AdminAuditLogsPage() {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  const logs = useQuery({ queryKey: ['admin', 'audit-logs', page], queryFn: () => api<unknown>(`/admin/audit-logs?page=${page}`) })
  const data = asRecord(logs.data)
  const rows = itemsOf<unknown>(logs.data).map(asRecord).filter((row): row is DataRecord => row !== null)
  const pages = Math.max(1, Number(data?.pages) || 1)

  return <AdminShell title="Audit Log" description="Review sensitive administrator actions. Document contents and private account data are not shown here.">
    <div className="mb-5 flex justify-end"><button type="button" className="button button-secondary" onClick={() => { void logs.refetch() }} disabled={logs.isFetching}>{t('Refresh queue')}</button></div>
    <QueryState loading={logs.isPending} error={logs.error ? messageOf(logs.error) : null} empty={rows.length === 0} emptyText={t('No audit events are available.')} onRetry={() => { void logs.refetch() }} />
    {!logs.isPending && !logs.error && rows.length > 0 && <ol className="space-y-3" aria-label={t('Audit events')}>
      {rows.map(row => {
        const actor = asRecord(row.actor)
        return <li key={firstText(row, 'id')} className="card grid gap-3 p-4 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center">
          <div><strong className="block break-words text-slate-900">{firstText(row, 'action') || t('Action unavailable')}</strong>
            <span className="mt-1 block break-words text-slate-600">{t('Target')}: {firstText(row, 'targetType') || '—'} {firstText(row, 'targetId')}</span></div>
          <div className="break-words text-slate-700">{t('Administrator')}: {firstText(actor, 'name', 'email') || t('Account unavailable')}</div>
          <time className="text-slate-600" dateTime={firstText(row, 'createdAt')}>{dateText(row.createdAt)}</time>
        </li>
      })}
    </ol>}
    {pages > 1 && !logs.error && <nav aria-label={t('Review queue pagination')} className="mt-5 flex items-center justify-end gap-3">
      <button type="button" className="button button-secondary button-small" disabled={page <= 1 || logs.isFetching} onClick={() => setPage(value => value - 1)}>{t('Previous')}</button>
      <span className="text-sm text-slate-700">{t('Page {page} of {pages}', { page, pages })}</span>
      <button type="button" className="button button-secondary button-small" disabled={page >= pages || logs.isFetching} onClick={() => setPage(value => value + 1)}>{t('Next')}</button>
    </nav>}
  </AdminShell>
}
