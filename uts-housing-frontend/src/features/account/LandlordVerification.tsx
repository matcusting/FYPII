import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { inputClass, labelForStatus } from './format'
import { ErrorNotice, LoadingNotice, Panel } from './shared'

type IdentityKind = 'INDIVIDUAL' | 'COMPANY'
interface IdentityStatus {
  status: string
  latest: { id: string; kind: IdentityKind; status: string; reason?: string | null; createdAt?: string; reviewedAt?: string | null } | null
}

function validFile(file: File | null, imageOnly: boolean): boolean {
  if (!file || file.size < 1 || file.size > 5_000_000) return false
  return (imageOnly ? ['image/jpeg', 'image/png'] : ['application/pdf', 'image/jpeg', 'image/png']).includes(file.type)
}

export function LandlordVerification() {
  const { user } = useAuth()
  const { t } = useI18n()
  const client = useQueryClient()
  const [kind, setKind] = useState<IdentityKind>('INDIVIDUAL')
  const [identity, setIdentity] = useState<File | null>(null)
  const [companyRegistration, setCompanyRegistration] = useState<File | null>(null)
  const [representativeAuthority, setRepresentativeAuthority] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [replaceApproved, setReplaceApproved] = useState(false)
  const status = useQuery({ queryKey: ['landlord-identity'], queryFn: () => api<IdentityStatus>('/landlord-verifications/me'), refetchInterval: 30_000 })
  const submit = useMutation({
    mutationFn: (body: FormData) => api('/landlord-verifications/identity', { method: 'POST', body }),
    onSuccess: async () => {
      setIdentity(null)
      setCompanyRegistration(null)
      setRepresentativeAuthority(null)
      setReplaceApproved(false)
      await client.invalidateQueries({ queryKey: ['landlord-identity'] })
    },
  })

  function chooseFile(field: 'identity' | 'company' | 'representative', event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] || null
    const imageOnly = field === 'identity'
    setError('')
    if (file && !validFile(file, imageOnly)) {
      setError(imageOnly ? 'Select a JPG or PNG identity photo no larger than 5 MB.' : 'Select a PDF, JPG or PNG document no larger than 5 MB.')
      event.currentTarget.value = ''
    }
    const selected = file && validFile(file, imageOnly) ? file : null
    if (field === 'identity') setIdentity(selected)
    else if (field === 'company') setCompanyRegistration(selected)
    else setRepresentativeAuthority(selected)
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (user?.emailVerified !== true) { setError('Verify your email before submitting identity documents.'); return }
    if (!identity) { setError('Choose your identity document photo.'); return }
    if (kind === 'COMPANY' && (!companyRegistration || !representativeAuthority)) { setError('Choose the company registration and representative authority documents.'); return }
    const body = new FormData()
    body.set('kind', kind)
    body.set('identity', identity)
    if (kind === 'COMPANY') {
      body.set('companyRegistration', companyRegistration!)
      body.set('representativeAuthority', representativeAuthority!)
    }
    setError('')
    submit.mutate(body)
  }

  const state = status.data?.status || 'UNVERIFIED'
  const pending = state === 'PENDING'
  const approved = state === 'APPROVED'
  return <Panel title={t('Landlord Identity Verification')}>
    {status.isPending ? <LoadingNotice /> : status.isError ? <ErrorNotice error={status.error} onRetry={() => void status.refetch()} /> : <div className="space-y-4 text-sm">
      <p className="text-gray-600">{t('Current status:')} <strong>{labelForStatus(state)}</strong></p>
      {status.data?.latest?.reason && state === 'REJECTED' && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{t('Reason: {reason}', { reason: t(status.data.latest.reason) })}</p>}
      {approved && !replaceApproved ? <div className="space-y-3"><p className="text-green-700">{t('Your identity has been reviewed. Each property still needs its own authorization review before publication.')}</p><button type="button" onClick={() => setReplaceApproved(true)} className="font-semibold text-[#203569] underline">{t('Replace Identity Documents')}</button></div>
        : pending ? <p className="text-gray-600">{t('Your identity documents are being reviewed. You can save property drafts while you wait.')}</p>
          : user?.emailVerified !== true ? <p className="text-amber-800">{t('Verify your email before submitting identity documents.')} <Link to="/verify-email" className="font-semibold underline">{t('Verify Email')}</Link></p>
            : <form noValidate onSubmit={send} className="space-y-5">
              {approved && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{t('Submitting a new identity application withdraws current approval. Published listings will pause, and every property will need new authorization.')}</div>}
              <p className="text-gray-600">{t('Submit your identity documents for private administrator review. An approved identity does not verify ownership of a property.')}</p>
              <fieldset><legend className="font-semibold text-gray-700">{t('Account holder type')}</legend><div className="mt-2 flex flex-wrap gap-3">
                <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 ${kind === 'INDIVIDUAL' ? 'border-[#203569] bg-blue-50' : 'border-gray-300'}`}><input type="radio" name="identity-kind" value="INDIVIDUAL" checked={kind === 'INDIVIDUAL'} onChange={() => setKind('INDIVIDUAL')} className="accent-[#203569]" />{t('Individual')}</label>
                <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 ${kind === 'COMPANY' ? 'border-[#203569] bg-blue-50' : 'border-gray-300'}`}><input type="radio" name="identity-kind" value="COMPANY" checked={kind === 'COMPANY'} onChange={() => setKind('COMPANY')} className="accent-[#203569]" />{t('Company')}</label>
              </div></fieldset>
              <label className="block font-semibold text-gray-700">{t('MyKad or passport photo')} *<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={event => chooseFile('identity', event)} className={`${inputClass} text-sm`} /></label>
              {kind === 'COMPANY' && <>
                <label className="block font-semibold text-gray-700">{t('Company registration document')} *<input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={event => chooseFile('company', event)} className={`${inputClass} text-sm`} /></label>
                <label className="block font-semibold text-gray-700">{t('Representative authorization document')} *<input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={event => chooseFile('representative', event)} className={`${inputClass} text-sm`} /></label>
              </>}
              <p className="text-xs text-gray-600">{t('JPG/PNG identity photo; PDF/JPG/PNG company documents; up to 5 MB each. Cover unrelated personal information. Only authorized reviewers can access these files.')}</p>
              {(error || submit.isError) && <p role="alert" className="text-red-700">{t(error || messageOf(submit.error))}</p>}
              <button type="submit" disabled={submit.isPending} className="min-h-11 rounded-lg bg-[#203569] px-4 py-2 font-semibold text-white hover:bg-[#172b59] disabled:opacity-60">{t(submit.isPending ? 'Submitting…' : 'Submit Identity for Review')}</button>
              {approved && <button type="button" disabled={submit.isPending} onClick={() => setReplaceApproved(false)} className="ml-3 font-semibold text-[#203569] underline">{t('Cancel')}</button>}
            </form>}
    </div>}
  </Panel>
}
