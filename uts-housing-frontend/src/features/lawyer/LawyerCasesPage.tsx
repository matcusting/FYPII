import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiResourceUrl, messageOf } from '../../lib/api'
import { useI18n } from '../../lib/i18n'

type CaseKind = 'identity' | 'property'
type Decision = 'APPROVE' | 'REJECT' | 'NEEDS_MORE_INFO'
type LegalCase = {
  id: string
  kind: CaseKind
  status: string
  applicantName: string
  applicantEmail?: string
  listingTitle?: string
  addressSnapshot?: string
  evidenceKind?: string
  assignedAt?: string
  decision?: Decision | null
  reason?: string | null
  sourceReference?: string | null
  reviewedAt?: string | null
  identityUrl?: string
  companyUrl?: string
  representativeUrl?: string
  proofUrl?: string
  supportingUrl?: string
}

function privateDocumentUrl(row: LegalCase, document: 'identity' | 'company' | 'representative' | 'proof' | 'supporting'): string | null {
  const source = ({ identity: row.identityUrl, company: row.companyUrl, representative: row.representativeUrl, proof: row.proofUrl, supporting: row.supportingUrl })[document]
  if (typeof source !== 'string') return null
  try {
    const url = new URL(source, window.location.origin)
    const path = `/api/v1/lawyer/cases/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}/${document}`
    return url.origin === window.location.origin && url.pathname === path && !url.search && !url.hash
      ? apiResourceUrl(`/lawyer/cases/${encodeURIComponent(row.kind)}/${encodeURIComponent(row.id)}/${document}`) : null
  } catch { return null }
}

const documents = [
  { key: 'identity', label: 'MyKad or passport photo' },
  { key: 'company', label: 'Company registration document' },
  { key: 'representative', label: 'Representative authorization document' },
  { key: 'proof', label: 'Primary property evidence' },
  { key: 'supporting', label: 'Supporting authorization evidence' },
] as const

export function LawyerCasesPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<{ kind: CaseKind; id: string } | null>(null)
  const [page, setPage] = useState(1)
  const [decision, setDecision] = useState<Decision>('APPROVE')
  const [reason, setReason] = useState('')
  const [sourceReference, setSourceReference] = useState('')
  const [identityMatched, setIdentityMatched] = useState(false)
  const [companyRegistryChecked, setCompanyRegistryChecked] = useState(false)
  const [authorityChecked, setAuthorityChecked] = useState(false)
  const [addressMatched, setAddressMatched] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const cases = useQuery({ queryKey: ['lawyer', 'cases', page], queryFn: () => api<{ items: LegalCase[]; page: number; pages: number }>(`/lawyer/cases?page=${page}`) })
  const detail = useQuery({
    queryKey: ['lawyer', 'case', selected?.kind, selected?.id],
    enabled: Boolean(selected),
    queryFn: () => api<LegalCase>(`/lawyer/cases/${selected!.kind}/${encodeURIComponent(selected!.id)}`),
  })
  const recommendation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api(`/lawyer/cases/${selected!.kind}/${encodeURIComponent(selected!.id)}/recommendation`, {
      method: 'POST', body: JSON.stringify(payload),
    }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['lawyer', 'cases'] }), queryClient.invalidateQueries({ queryKey: ['lawyer', 'case', selected?.kind, selected?.id] })])
      setSuccess(t('Legal recommendation saved. The administrator makes the final decision.'))
      setError('')
    },
  })

  function choose(item: LegalCase) {
    setSelected(current => current?.id === item.id && current.kind === item.kind ? null : { kind: item.kind, id: item.id })
    setDecision('APPROVE')
    setReason('')
    setSourceReference('')
    setIdentityMatched(false)
    setCompanyRegistryChecked(false)
    setAuthorityChecked(false)
    setAddressMatched(false)
    setError('')
    setSuccess('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !detail.data || detail.data.status !== 'PENDING' || detail.data.decision) return
    if (decision === 'APPROVE') {
      if (sourceReference.trim().length < 4) { setError('Record a non-sensitive independent source or case reference.'); return }
      if (selected.kind === 'identity' && (!identityMatched || (detail.data.evidenceKind === 'COMPANY' && !companyRegistryChecked))) { setError('Confirm the identity and company checks before recommending approval.'); return }
      if (selected.kind === 'property' && (!authorityChecked || !addressMatched)) { setError('Confirm the right to rent and address match before recommending approval.'); return }
    }
    if (reason.trim().length < 10) { setError('Write a private finding of at least 10 characters for this recommendation.'); return }
    setError('')
    setSuccess('')
    recommendation.mutate({ decision, reason: reason.trim(), sourceReference: sourceReference.trim() || undefined, ...(selected.kind === 'identity' ? { identityMatched, companyRegistryChecked } : { authorityChecked, addressMatched }) })
  }

  const row = detail.data
  return <section className="mx-auto my-8 max-w-5xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8" aria-labelledby="lawyer-page-title">
    <h1 id="lawyer-page-title" className="text-2xl font-bold text-[#203569]">{t('Legal Review Cases')}</h1>
    <p className="mt-2 text-sm text-slate-600">{t('Only cases assigned to your reviewer account appear here. Your recommendation is private; an administrator decides whether to approve the application.')}</p>
    {success && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
    {cases.isPending && <p role="status" className="mt-5">{t('Loading data…')}</p>}
    {cases.error && <p role="alert" className="mt-5 text-red-700">{messageOf(cases.error)}</p>}
    {cases.data?.items.length === 0 && <p role="status" className="mt-5">{t('No cases are assigned to you.')}</p>}
    <div className="mt-6 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <ul className="space-y-2" aria-label={t('Assigned cases')}>
        {(cases.data?.items || []).map(item => <li key={`${item.kind}-${item.id}`}>
          <button type="button" onClick={() => choose(item)} aria-expanded={selected?.kind === item.kind && selected.id === item.id} className="w-full rounded-lg border border-slate-200 p-4 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#203569]">
            <span className="block font-semibold text-slate-900">{t(item.kind === 'identity' ? 'Landlord identity' : 'Property authorization')} · {item.applicantName}</span>
            {item.listingTitle && <span className="block text-sm text-slate-700">{item.listingTitle}</span>}
            <span className="mt-1 block text-xs text-slate-500">{t(item.decision ? 'Recommendation submitted' : 'Awaiting legal recommendation')}</span>
          </button>
        </li>)}
      </ul>
      {(cases.data?.pages || 0) > 1 && <nav className="flex items-center gap-3 text-sm" aria-label={t('Case pages')}>
        <button type="button" className="button button-secondary button-small" disabled={page <= 1} onClick={() => { setPage(value => value - 1); setSelected(null) }}>{t('Previous')}</button>
        <span>{t('Page {page} of {pages}', { page, pages: cases.data!.pages })}</span>
        <button type="button" className="button button-secondary button-small" disabled={page >= cases.data!.pages} onClick={() => { setPage(value => value + 1); setSelected(null) }}>{t('Next')}</button>
      </nav>}
      <div aria-live="polite">
        {selected && detail.isPending && <p role="status">{t('Loading data…')}</p>}
        {selected && detail.error && <p role="alert" className="text-red-700">{messageOf(detail.error)}</p>}
        {selected && row && !detail.error && <div className="rounded-lg border border-slate-200 p-5">
          <h2 className="text-xl font-bold text-slate-900">{t(selected.kind === 'identity' ? 'Landlord identity' : 'Property authorization')}</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold">{t('Applicant')}</dt><dd className="break-words">{row.applicantName}</dd></div>
            <div><dt className="font-semibold">{t('Email')}</dt><dd className="break-words">{row.applicantEmail}</dd></div>
            {row.evidenceKind && <div><dt className="font-semibold">{t('Evidence type')}</dt><dd>{t(row.evidenceKind)}</dd></div>}
            {row.listingTitle && <div><dt className="font-semibold">{t('Listing')}</dt><dd>{row.listingTitle}</dd></div>}
            {row.addressSnapshot && <div className="sm:col-span-2"><dt className="font-semibold">{t('Full Property Address')}</dt><dd className="break-words">{row.addressSnapshot}</dd></div>}
          </dl>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">{documents.map(document => {
            const url = privateDocumentUrl(row, document.key)
            return url && <a key={document.key} href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-[#203569] underline">{t(document.label)}</a>
          })}</div>
          <p className="mt-3 text-xs text-slate-600">{t('Review private documents only on a protected computer. Do not copy them into email, chat, or public storage.')}</p>
          {row.decision ? <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
            <p className="font-semibold">{t('Recommendation submitted')}: {t(row.decision)}</p>
            {row.reason && <p className="mt-2 whitespace-pre-wrap break-words">{row.reason}</p>}
          </div> : row.status === 'PENDING' ? <form onSubmit={submit} noValidate className="mt-5 space-y-4 border-t border-slate-200 pt-5">
            <label className="block text-sm font-semibold">{t('Recommendation')}<select value={decision} onChange={event => setDecision(event.target.value as Decision)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2"><option value="APPROVE">{t('Recommend approval')}</option><option value="REJECT">{t('Recommend rejection')}</option><option value="NEEDS_MORE_INFO">{t('Request more information')}</option></select></label>
            {decision === 'APPROVE' && <>
              <label className="block text-sm font-semibold">{t('Independent source or case reference')}<input value={sourceReference} onChange={event => setSourceReference(event.target.value)} required minLength={4} maxLength={160} autoComplete="off" className="mt-1 block w-full rounded-lg border border-slate-300 p-2" /></label>
              <p className="text-xs text-slate-600">{t('Record only a non-sensitive reference, never MyKad numbers, signatures or full document contents.')}</p>
              {selected.kind === 'identity' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={identityMatched} onChange={event => setIdentityMatched(event.target.checked)} />{t('I independently matched the applicant with the photo ID and account name.')}</label>}
              {selected.kind === 'identity' && row.evidenceKind === 'COMPANY' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={companyRegistryChecked} onChange={event => setCompanyRegistryChecked(event.target.checked)} />{t('I checked the company registry and representative authorization independently.')}</label>}
              {selected.kind === 'property' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={authorityChecked} onChange={event => setAuthorityChecked(event.target.checked)} />{t('I independently checked the applicant’s right to rent this property.')}</label>}
              {selected.kind === 'property' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={addressMatched} onChange={event => setAddressMatched(event.target.checked)} />{t('I matched the evidence and owner consent to this address.')}</label>}
            </>}
            <label className="block text-sm font-semibold">{t('Private written finding (required)')}<textarea value={reason} onChange={event => setReason(event.target.value)} required minLength={10} maxLength={2000} rows={3} className="mt-1 block w-full rounded-lg border border-slate-300 p-2" /></label>
            {error && <p role="alert" className="text-sm text-red-700">{t(error)}</p>}
            {recommendation.error && <p role="alert" className="text-sm text-red-700">{messageOf(recommendation.error)}</p>}
            <button type="submit" disabled={recommendation.isPending} className="button">{t(recommendation.isPending ? 'Saving…' : 'Submit recommendation')}</button>
          </form> : <p className="mt-5 text-sm text-slate-600">{t('This case is no longer awaiting legal review.')}</p>}
        </div>}
      </div>
    </div>
  </section>
}
