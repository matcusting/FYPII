import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { homeForUser } from '../../lib/routeAccess'
import { AuthLayout, fieldClass, FormNotice, primaryButtonClass } from './ui'

type SetupResult = { secret: string; authenticatorUri: string; expiresInSeconds: number }

export function MfaSetupPage() {
  const { t } = useI18n()
  const { user, loading, refresh } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<SetupResult | null>(null)
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <p role="status">{t('Checking your sign-in status…')}</p>
  if (!user) return <Navigate to="/login" replace />
  if (!hasRole(user, 'ADMIN', 'LAWYER')) return <Navigate to={homeForUser(user)} replace />

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api<SetupResult>('/auth/mfa/setup', { method: 'POST', body: JSON.stringify({ password }) })
      setSetup(result)
      setPassword('')
    } catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ enrolled: true; recoveryCodes: string[] }>('/auth/mfa/confirm', { method: 'POST', body: JSON.stringify({ code }) })
      setRecoveryCodes(result.recoveryCodes)
      setCode('')
      setSetup(null)
      await refresh()
    } catch (failure) { setError(messageOf(failure)) }
    finally { setBusy(false) }
  }

  return <AuthLayout title="Set Up Authenticator" description="Administrator and legal reviewer accounts use an authenticator app for a second sign-in factor.">
    <FormNotice error={error} />
    {recoveryCodes ? <div className="space-y-4">
      <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-900">{t('Authenticator enabled. Save these recovery codes in a secure place. Each code works once and they will not be shown again.')}</p>
      <pre className="whitespace-pre-wrap break-all rounded-lg border bg-slate-50 p-4 font-mono text-sm" aria-label={t('Recovery codes')}>{recoveryCodes.join('\n')}</pre>
      <button type="button" onClick={() => navigate(homeForUser(user), { replace: true })} className={`${primaryButtonClass} w-full`}>{t('Continue to Dashboard')}</button>
    </div> : setup ? <form onSubmit={confirm} className="space-y-4">
      <p>{t('Add this secret to your authenticator app. The setup code expires in 10 minutes.')}</p>
      <p className="break-all rounded-lg border bg-slate-50 p-3 font-mono text-sm" aria-label={t('Authenticator secret')}>{setup.secret}</p>
      <a className="font-semibold text-blue-800 underline" href={setup.authenticatorUri}>{t('Open in authenticator app')}</a>
      <div><label htmlFor="mfa-confirm-code" className="font-medium text-slate-800">{t('Six-digit authenticator code')}</label><input id="mfa-confirm-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value)} className={fieldClass} /></div>
      <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>{t('Confirm Authenticator')}</button>
      <button type="button" onClick={() => { setSetup(null); setCode('') }} className="text-sm font-semibold text-blue-800 underline">{t('Start setup again')}</button>
    </form> : <form onSubmit={start} className="space-y-4">
      {user.mfaSetupRequired ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">{t('Complete this step before accessing administrator or legal review pages.')}</p> : <p>{t('You can replace your authenticator and recovery codes here. Other sessions will be signed out.')}</p>}
      <div><label htmlFor="mfa-password" className="font-medium text-slate-800">{t('Password')}</label><input id="mfa-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} className={fieldClass} /></div>
      <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>{t('Begin Authenticator Setup')}</button>
      {!user.mfaSetupRequired && <Link to={homeForUser(user)} className="block text-center text-sm font-semibold text-blue-800 underline">{t('Back to Dashboard')}</Link>}
    </form>}
  </AuthLayout>
}
