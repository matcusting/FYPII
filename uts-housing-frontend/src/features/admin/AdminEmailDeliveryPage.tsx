import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, messageOf } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { AdminShell, Notice, QueryState } from './shared'

type DeliveryStatus = {
  mode: 'smtp' | 'localOutbox' | 'invalid'
  senderConfigured: boolean
  issue: string | null
  queue: {
    pending: number
    retrying: number
    exhausted: number
    acceptedByTransport: number
    latestAcceptedAt: string | null
  }
}

export function AdminEmailDeliveryPage() {
  const { t, locale } = useI18n()
  const delivery = useQuery({ queryKey: ['admin', 'email-delivery'], queryFn: () => api<DeliveryStatus>('/operations/email-delivery'), refetchInterval: 15_000 })
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkSuccess, setCheckSuccess] = useState<string | null>(null)
  const status = delivery.data

  async function checkConnection() {
    setChecking(true)
    setCheckError(null)
    setCheckSuccess(null)
    try {
      await api('/operations/email-delivery/check-connection', { method: 'POST' })
      setCheckSuccess('The SMTP server accepted the connection. Send a test message with npm run email:check to confirm inbox delivery.')
    } catch (error) {
      setCheckError(messageOf(error))
    } finally {
      setChecking(false)
    }
  }

  return <AdminShell title="Email Delivery" description="Check whether account emails can leave this computer and whether messages are waiting in the queue.">
    <QueryState loading={delivery.isPending} error={delivery.error ? messageOf(delivery.error) : null} empty={!status} emptyText="Email delivery status is unavailable." onRetry={() => { void delivery.refetch() }} />
    {status && !delivery.error && <div className="space-y-5">
      <div className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold text-slate-900">{t('Delivery mode')}</h2>
        <p className="text-sm font-semibold text-[#203569]">{t(status.mode === 'smtp' ? 'SMTP provider configured' : status.mode === 'localOutbox' ? 'Local outbox only' : 'Email configuration needs attention')}</p>
        {status.mode === 'localOutbox' && <p className="text-sm text-amber-900">{t('Verification codes and password reset links are written to uts-housing-api/data/outbox on the API computer. They are not sent to real inboxes. Configure SMTP_HOST and EMAIL_FROM in the private API .env file, then restart the API and email worker.')}</p>}
        {status.mode === 'smtp' && <p className="text-sm text-slate-700">{t('SMTP is configured, but this alone does not prove inbox delivery. Check the connection, then run the test-email command with an address you own.')}</p>}
        {status.issue && <p role="alert" className="text-sm text-red-800">{t(status.issue)}</p>}
        <button type="button" disabled={checking || status.mode !== 'smtp'} onClick={() => { void checkConnection() }} className="button button-secondary">{checking ? t('Checking connection…') : t('Check SMTP connection')}</button>
        <Notice error={checkError} success={checkSuccess} />
      </div>
      <div className="card p-5">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">{t('Email queue')}</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-sm text-slate-600">{t('Waiting')}</dt><dd className="text-xl font-semibold">{status.queue.pending}</dd></div>
          <div><dt className="text-sm text-slate-600">{t('Retrying')}</dt><dd className="text-xl font-semibold">{status.queue.retrying}</dd></div>
          <div><dt className="text-sm text-slate-600">{t('Stopped after five attempts')}</dt><dd className="text-xl font-semibold">{status.queue.exhausted}</dd></div>
          <div><dt className="text-sm text-slate-600">{t('Accepted by transport or saved to local outbox')}</dt><dd className="text-xl font-semibold">{status.queue.acceptedByTransport}</dd></div>
        </dl>
        {status.queue.latestAcceptedAt && <p className="mt-4 text-sm text-slate-600">{t('Latest accepted:')} {new Intl.DateTimeFormat(locale === 'ms' ? 'ms-MY' : locale === 'zh-CN' ? 'zh-CN' : 'en-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(status.queue.latestAcceptedAt))}</p>}
        <p className="mt-4 text-xs text-slate-600">{t('A message counted as accepted may still be blocked by the recipient provider. Local outbox messages never leave this computer. If a verification code expired, request a new one from Verify Email.')}</p>
      </div>
    </div>}
  </AdminShell>
}
