import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, messageOf } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { AdminShell, Notice } from '../admin/shared'

type CaseKind = 'identity' | 'property'
type Reviewer = { id: string; name: string; email: string }
type AdminCase = {
  id: string
  status: string
  kind: string
  createdAt: string
  landlord?: { name: string; email: string }
  listing?: { title: string }
  addressSnapshot?: string
}
type LegalReview = {
  lawyerId: string
  lawyerName: string
  assignedAt: string
  decision: 'APPROVE' | 'REJECT' | 'NEEDS_MORE_INFO' | null
  reason: string | null
  sourceReference: string | null
  reviewedAt: string | null
  identityMatched?: boolean
  companyRegistryChecked?: boolean
  authorityChecked?: boolean
  addressMatched?: boolean
}
type AdminDetail = AdminCase & { lawyerReviewRequired?: boolean; lawyerReview?: LegalReview | null }

const kinds = [
  { value: 'identity' as const, route: 'landlord-verifications', title: 'Landlord identity' },
  { value: 'property' as const, route: 'property-authorizations', title: 'Property authorization' },
]

export function AdminLawyerCasesPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<{ kind: CaseKind; id: string } | null>(null)
  const [lawyerId, setLawyerId] = useState('')
  const [pages, setPages] = useState({ identity: 1, property: 1 })
  const [notice, setNotice] = useState('')
  const [validation, setValidation] = useState('')
  const reviewers = useQuery({ queryKey: ['admin', 'lawyer-reviewers'], queryFn: () => api<{ items: Reviewer[] }>('/admin/lawyer-reviewers') })
  const identity = useQuery({ queryKey: ['admin', 'lawyer-cases', 'identity', pages.identity], queryFn: () => api<{ items: AdminCase[]; pages: number }>(`/admin/landlord-verifications?status=PENDING&page=${pages.identity}`) })
  const property = useQuery({ queryKey: ['admin', 'lawyer-cases', 'property', pages.property], queryFn: () => api<{ items: AdminCase[]; pages: number }>(`/admin/property-authorizations?status=PENDING&page=${pages.property}`) })
  const selectedKind = kinds.find(item => item.value === selected?.kind)
  const detail = useQuery({
    queryKey: ['admin', 'lawyer-cases', 'detail', selected?.kind, selected?.id],
    enabled: Boolean(selected && selectedKind),
    queryFn: () => api<AdminDetail>(`/admin/${selectedKind!.route}/${encodeURIComponent(selected!.id)}`),
  })
  const assignment = useMutation({
    mutationFn: (nextId: string | null) => api('/admin/lawyer-assignments', {
      method: 'POST', body: JSON.stringify({ kind: selected!.kind, id: selected!.id, lawyerId: nextId }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'lawyer-cases'] })
      setNotice(t('Legal reviewer assignment saved.'))
      setValidation('')
      setLawyerId('')
    },
  })

  function select(kind: CaseKind, id: string) {
    setSelected(current => current?.kind === kind && current.id === id ? null : { kind, id })
    setLawyerId('')
    setNotice('')
    setValidation('')
    assignment.reset()
  }

  const review = detail.data?.lawyerReview
  const selectedLawyerId = lawyerId || review?.lawyerId || ''
  return <AdminShell title="Legal Reviewer Assignments" description="Assign each pending landlord identity and property authorization case to a restricted legal reviewer. Only an administrator makes the final decision.">
    <Notice success={notice} error={validation || (assignment.error ? messageOf(assignment.error) : null)} />
    {reviewers.isPending && <p role="status" className="mt-4">{t('Loading data…')}</p>}
    {reviewers.error && <p role="alert" className="mt-4 text-red-700">{messageOf(reviewers.error)}</p>}
    {reviewers.data?.items.length === 0 && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{t('No active legal reviewer account exists. Provision one securely before assigning cases; do not give the law firm an administrator password.')}</p>}
    {kinds.map(kind => {
      const list = kind.value === 'identity' ? identity : property
      const page = pages[kind.value]
      return <section key={kind.value} className="mt-7" aria-labelledby={`legal-${kind.value}`}>
        <h2 id={`legal-${kind.value}`} className="text-lg font-bold text-slate-900">{t(kind.title)}</h2>
        {list.isPending && <p role="status" className="mt-3">{t('Loading data…')}</p>}
        {list.error && <p role="alert" className="mt-3 text-red-700">{messageOf(list.error)}</p>}
        {list.data?.items.length === 0 && <p className="mt-3 text-sm text-slate-600">{t('No pending cases.')}</p>}
        <ul className="mt-3 space-y-2">{(list.data?.items || []).map(item => <li key={item.id}>
          <button type="button" onClick={() => select(kind.value, item.id)} aria-expanded={selected?.kind === kind.value && selected.id === item.id} className="w-full rounded-lg border border-slate-200 p-3 text-left text-sm hover:bg-slate-50">
            <strong className="block break-words">{kind.value === 'identity' ? item.landlord?.name || item.landlord?.email : item.listing?.title || item.addressSnapshot || item.id}</strong>
            <span className="mt-1 block break-words text-slate-600">{kind.value === 'identity' ? item.landlord?.email : item.addressSnapshot}</span>
          </button>
        </li>)}</ul>
        {(list.data?.pages || 0) > 1 && <div className="mt-3 flex items-center gap-2 text-sm">
          <button type="button" className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPages(value => ({ ...value, [kind.value]: page - 1 }))}>{t('Previous')}</button>
          <span>{t('Page {page} of {pages}', { page, pages: list.data!.pages })}</span>
          <button type="button" className="button button-secondary button-small" disabled={page >= list.data!.pages} onClick={() => setPages(value => ({ ...value, [kind.value]: page + 1 }))}>{t('Next')}</button>
        </div>}
      </section>
    })}
    {selected && <section className="mt-7 rounded-lg border border-blue-200 bg-blue-50 p-4" aria-labelledby="assignment-title">
      <h2 id="assignment-title" className="font-bold text-slate-900">{t('Assigned legal reviewer')}</h2>
      {detail.isPending && <p role="status" className="mt-2">{t('Loading data…')}</p>}
      {detail.error && <p role="alert" className="mt-2 text-red-700">{messageOf(detail.error)}</p>}
      {detail.data && !detail.error && <>
        <p className="mt-2 text-sm text-slate-700">{review ? `${review.lawyerName} · ${review.decision ? t('Recommendation submitted') : t('Awaiting legal recommendation')}` : t('No reviewer assigned yet.')}</p>
        {review?.decision && <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <p className="font-semibold">{t('Legal recommendation')}: {t(review.decision)}</p>
          {review.sourceReference && <p className="mt-2 break-words">{t('Private source/reference')}: {review.sourceReference}</p>}
          {review.reason && <p className="mt-2 whitespace-pre-wrap break-words">{t('Private legal note')}: {review.reason}</p>}
          <p className="mt-2 text-slate-600">{t('The final administrator must review the evidence and decide separately.')}</p>
        </div>}
        {review?.decision && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{t('Reassigning or removing this reviewer clears the submitted recommendation. The new reviewer must check the case again.')}</p>}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-60 flex-1 text-sm font-semibold">{t('Choose legal reviewer')}<select value={selectedLawyerId} onChange={event => setLawyerId(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2"><option value="">{t('Select reviewer')}</option>{(reviewers.data?.items || []).map(item => <option key={item.id} value={item.id}>{item.name} ({item.email})</option>)}</select></label>
          <button type="button" className="button" disabled={assignment.isPending || !selectedLawyerId || selectedLawyerId === review?.lawyerId} onClick={() => { if (!selectedLawyerId) { setValidation('Select a legal reviewer first.'); return } assignment.mutate(selectedLawyerId) }}>{t(review ? 'Reassign reviewer' : 'Assign reviewer')}</button>
          {review && <button type="button" className="button button-secondary" disabled={assignment.isPending} onClick={() => assignment.mutate(null)}>{t('Remove assignment')}</button>}
        </div>
        <Link to={selected.kind === 'identity' ? '/admin/landlord-verifications' : '/admin/property-authorizations'} className="mt-4 inline-block text-sm font-semibold text-[#203569] underline">{t('Open final moderation queue')}</Link>
      </>}
    </section>}
  </AdminShell>
}
