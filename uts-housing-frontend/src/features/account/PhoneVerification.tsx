import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { Panel } from './shared'
import { inputClass } from './format'

interface PhoneState {
  phone: string | null
  verified: boolean
  testCompleted: boolean
  available: boolean
  localOutbox: boolean
}

export function PhoneVerification({ phone }: { phone: string | null }) {
  const { user } = useAuth()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState('')
  const state = useQuery({ queryKey: ['phone-verification'], queryFn: () => api<PhoneState>('/phone-verification'), enabled: !!user })
  const request = useMutation({ mutationFn: () => api('/phone-verification/request', { method: 'POST' }),
    onSuccess: () => setNotice('A verification code was prepared for your saved phone number.') })
  const confirm = useMutation({ mutationFn: (value: string) => api<{ verified: boolean; testCompleted: boolean }>('/phone-verification/confirm', { method: 'POST', body: JSON.stringify({ code: value }) }),
    onSuccess: async result => { setCode(''); setNotice(result.verified ? 'Phone number verified.' : 'Local SMS test completed. This does not verify phone ownership.'); await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['phone-verification'] }), queryClient.invalidateQueries({ queryKey: ['profile'] }),
    ]) } })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code.trim())) return
    confirm.mutate(code.trim())
  }

  return <Panel title={t('Phone Verification')}>
    {state.isPending ? <p className="text-sm text-gray-600">{t('Loading…')}</p> : state.isError ? <p role="alert" className="text-sm text-red-700">{messageOf(state.error)}</p> : <div className="space-y-4 text-sm">
      <p>{t('Saved phone number:')} <strong>{state.data?.phone || t('None')}</strong></p>
      {state.data?.verified ? <p className="text-green-700">{t('Your phone number is verified. Changing it will require a new code.')}</p>
        : state.data?.testCompleted ? <p className="text-blue-800">{t('Local SMS test completed. This does not verify phone ownership.')}</p>
        : !phone ? <p className="text-gray-600">{t('Save your phone number above before requesting a code.')}</p>
          : !user?.emailVerified ? <p className="text-amber-800">{t('Verify your email first.')} <Link to="/verify-email" className="underline">{t('Verify Email')}</Link></p>
            : !state.data?.available ? <p className="text-amber-800">{t('SMS delivery is not configured on this site yet.')}</p>
              : <>
                {state.data.localOutbox && <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900">{t('Local test mode: no real SMS is sent. The code is saved in uts-housing-api/data/sms-outbox on this computer.')}</p>}
                <button type="button" onClick={() => { setNotice(''); request.mutate() }} disabled={request.isPending} className="min-h-11 rounded-lg bg-[#203569] px-4 py-2 font-semibold text-white disabled:opacity-60">{request.isPending ? t('Sending…') : t('Send verification code')}</button>
                <p className="text-xs text-gray-600">{t('Codes expire after 10 minutes. You can request a new code after 10 minutes.')}</p>
                <form onSubmit={submit} className="space-y-3">
                  <label className="block font-semibold">{t('Six-digit SMS code')}<input className={inputClass} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" required /></label>
                  <button type="submit" disabled={confirm.isPending || code.length !== 6} className="min-h-11 rounded-lg bg-[#203569] px-4 py-2 font-semibold text-white disabled:opacity-60">{confirm.isPending ? t('Verifying…') : t('Verify Phone')}</button>
                </form>
              </>}
      {notice && <p role="status" className="text-green-700">{t(notice)}</p>}
      {request.isError && <p role="alert" className="text-red-700">{messageOf(request.error)}</p>}
      {confirm.isError && <p role="alert" className="text-red-700">{messageOf(confirm.error)}</p>}
    </div>}
  </Panel>
}
