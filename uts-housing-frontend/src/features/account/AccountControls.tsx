import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { translate, useI18n } from '../../lib/i18n'
import { formatDate, inputClass } from './format'
import { EmptyNotice, ErrorNotice, LoadingNotice, Panel } from './shared'

interface Session {
  id: string
  device?: string
  userAgent?: string
  createdAt?: string
  lastActiveAt?: string
  current?: boolean
}

interface NotificationPreferences {
  emailInquiryUpdates: boolean
  emailConnectionRequests: boolean
  emailProductUpdates: boolean
}

interface NotificationItem {
  id: string
  type: string
  payload?: Record<string, unknown>
  readAt?: string | null
  createdAt?: string
}

interface NotificationPage {
  items: NotificationItem[]
  pages: number
  unreadCount: number
}

function notificationText(item: NotificationItem): { title: string; message: string; to: string } {
  const titles: Record<string, [string, string, string]> = {
    INQUIRY_RECEIVED: ['New property inquiry', 'A student asked about your listing.', '/requests'],
    INQUIRY_REPLY: ['Property inquiry reply', 'You have a new reply.', '/requests'],
    ROOMMATE_CONNECTION_REQUEST: ['New roommate request', 'A student would like to connect.', '/requests'],
    ROOMMATE_CONNECTION_RESPONSE: ['Roommate request updated', 'Your connection request has been answered.', '/requests'],
    ROOMMATE_MESSAGE: ['New roommate message', 'You have a new message.', '/requests'],
    REVIEW_SUBMITTED: ['New property review', 'A review is awaiting approval.', '/my-listings'],
    REVIEW_MODERATION: ['Review decision', 'Your review has been reviewed.', '/reviews/mine'],
    LISTING_MODERATION: ['Listing decision', 'Your listing has been reviewed.', '/my-listings'],
    STUDENT_VERIFICATION: ['Student verification', 'Your verification request has been reviewed.', '/profile'],
    STUDENT_VERIFIED: ['Student verified', 'Your student status has been verified.', '/profile'],
  }
  const [fallbackTitle, fallbackMessage, to] = titles[item.type] || ['Account update', 'There is an update to your account.', '/profile']
  const title = typeof item.payload?.title === 'string' ? localizedNotificationText(item.payload.title.slice(0, 120)) : translate(fallbackTitle)
  const message = typeof item.payload?.message === 'string' ? localizedNotificationText(item.payload.message.slice(0, 500)) : translate(fallbackMessage)
  return { title, message, to }
}

function localizedNotificationText(value: string): string {
  const title = /^(Student verification|Listing|Review|Report|Account) (approved|rejected|published|paused|resolved|dismissed|active|suspended)$/.exec(value)
  if (title) return translate(value)
  const listingPublished = /^Your listing "(.*)" is now published\.$/.exec(value)
  if (listingPublished) return translate('Your listing "{title}" is now published.', { title: listingPublished[1] })
  const listingDecision = /^Your listing "(.*)" was (rejected|paused): (.*)$/.exec(value)
  if (listingDecision) return translate(`Your listing "{title}" was ${listingDecision[2]}: {reason}`, { title: listingDecision[1], reason: listingDecision[3] })
  const reason = /^(Your student verification was rejected|Your property review was rejected|Your report was dismissed|Your account was suspended): (.*)$/.exec(value)
  if (reason) return translate(`${reason[1]}: {reason}`, { reason: reason[2] })
  return translate(value)
}

function NotificationsInbox() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const notifications = useQuery({
    queryKey: ['notifications', page],
    queryFn: () => api<NotificationPage>(`/notifications?page=${page}&limit=10`),
    refetchInterval: 30_000,
  })
  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['notifications'] }) },
  })
  const markAllRead = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'PATCH' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['notifications'] }) },
  })
  const rows = notifications.data?.items || []
  const pages = Math.max(1, notifications.data?.pages || 1)
  return <Panel title={t('Notifications')} action={notifications.data?.unreadCount ? <button type="button" className="text-sm font-semibold text-[#203569] underline" disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>{t('Mark all as read ({count})', { count: notifications.data.unreadCount })}</button> : undefined}>
    {notifications.isPending ? <LoadingNotice /> : notifications.isError ? <ErrorNotice error={notifications.error} onRetry={() => void notifications.refetch()} /> : rows.length ? <>
      <ul className="divide-y divide-slate-100">{rows.map(item => {
        const content = notificationText(item)
        return <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{content.title}{!item.readAt && <span className="ml-2 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs text-[#203569]">{t('New')}</span>}</p><p className="mt-1 break-words text-sm text-slate-600">{content.message}</p><p className="mt-1 text-xs text-slate-500">{formatDate(item.createdAt)}</p></div>
          <div className="flex items-center gap-3 text-sm"><Link to={content.to} className="font-semibold text-[#203569] underline">{t('View')}</Link>{!item.readAt && <button type="button" className="font-semibold text-slate-600 underline" disabled={markRead.isPending} onClick={() => markRead.mutate(item.id)}>{t('Mark read')}</button>}</div>
        </li>
      })}</ul>
      {pages > 1 && <nav className="mt-5 flex items-center justify-end gap-3 text-sm" aria-label={t('Notification pages')}><button type="button" className="font-semibold text-[#203569] disabled:text-slate-400" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t('Previous')}</button><span>{t('Page {page} of {pages}', { page, pages })}</span><button type="button" className="font-semibold text-[#203569] disabled:text-slate-400" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>{t('Next')}</button></nav>}
    </> : <EmptyNotice>{t('No notifications yet.')}</EmptyNotice>}
    {(markRead.isError || markAllRead.isError) && <p role="alert" className="mt-3 text-sm text-red-700">{t(messageOf(markRead.error || markAllRead.error))}</p>}
  </Panel>
}

function parseSessions(value: unknown): Session[] {
  let records: unknown = value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    records = object.sessions || object.items
  }
  if (!Array.isArray(records)) throw new Error('The server did not provide a session list.')
  return records.filter((entry): entry is Session => !!entry && typeof entry === 'object' && typeof entry.id === 'string')
}

function parsePreferences(value: unknown): NotificationPreferences {
  if (!value || typeof value !== 'object') throw new Error('The server did not provide notification settings.')
  const object = value as Record<string, unknown>
  for (const key of ['emailInquiryUpdates', 'emailConnectionRequests', 'emailProductUpdates']) {
    if (typeof object[key] !== 'boolean') throw new Error('The notification settings returned by the server are incomplete.')
  }
  return object as unknown as NotificationPreferences
}

function NotificationControls() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [edits, setEdits] = useState<Partial<NotificationPreferences>>({})
  const preferences = useQuery({ queryKey: ['notification-preferences'], queryFn: async () => parsePreferences(await api<unknown>('/notifications/preferences')) })
  const values = preferences.data ? { ...preferences.data, ...edits } : null
  const save = useMutation({
    mutationFn: (changes: Partial<NotificationPreferences>) => api('/notifications/preferences', { method: 'PATCH', body: JSON.stringify(changes) }),
    onSuccess: async (_data, changes) => {
      queryClient.setQueryData<NotificationPreferences>(['notification-preferences'], old => old ? { ...old, ...changes } : old)
      setEdits({})
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences'] })
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (Object.keys(edits).length) save.mutate(edits)
  }

  return <Panel title={t('Email Notifications')}>
    <p className="mb-4 text-sm text-slate-600">{t('You can turn off these optional emails. Account security, email verification and password reset messages will still be sent.')}</p>
    {preferences.isPending ? <LoadingNotice /> : preferences.isError ? <ErrorNotice error={preferences.error} onRetry={() => void preferences.refetch()} /> : values && <form onSubmit={submit} noValidate className="space-y-4">
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={values.emailInquiryUpdates} onChange={event => setEdits(previous => ({ ...previous, emailInquiryUpdates: event.target.checked }))} /><span>{t('Property inquiry emails')}</span></label>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={values.emailConnectionRequests} onChange={event => setEdits(previous => ({ ...previous, emailConnectionRequests: event.target.checked }))} /><span>{t('Roommate connection request emails')}</span></label>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={values.emailProductUpdates} onChange={event => setEdits(previous => ({ ...previous, emailProductUpdates: event.target.checked }))} /><span>{t('Product update emails')}</span></label>
      {save.isError && <p role="alert" className="text-sm text-red-700">{t(messageOf(save.error))}</p>}
      {save.isSuccess && !Object.keys(edits).length && <p role="status" className="text-sm text-green-700">{t('Notification settings saved.')}</p>}
      <button type="submit" disabled={save.isPending || !Object.keys(edits).length} className="min-h-11 rounded-lg bg-[#203569] px-4 py-2 text-sm font-semibold text-white hover:bg-[#172b59] disabled:opacity-50">{save.isPending ? t('Saving…') : t('Save Notification Settings')}</button>
    </form>}
  </Panel>
}

function SessionControls() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const sessions = useQuery({ queryKey: ['account-sessions'], queryFn: async () => parseSessions(await api<unknown>('/auth/sessions')) })
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['account-sessions'] }) },
  })

  return <Panel title={t('Signed-in Devices')}>
    <p className="mb-4 text-sm text-slate-600">{t('Review your active sessions. To end the session on this device, use Logout at the top of the page.')}</p>
    {sessions.isPending ? <LoadingNotice /> : sessions.isError ? <ErrorNotice error={sessions.error} onRetry={() => void sessions.refetch()} /> : sessions.data?.length ? <ul className="divide-y divide-slate-200">
      {sessions.data.map(session => <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold">{session.device || session.userAgent || t('Unknown device')} {session.current && <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">{t('Current device')}</span>}</p>
          <p className="mt-1 text-xs text-slate-600">{t('Last active:')} {formatDate(session.lastActiveAt || session.createdAt)}</p>
        </div>
        {!session.current && <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(session.id)} className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" aria-label={t('End session on {device}', { device: session.device || t('this device') })}>{t('End Session')}</button>}
      </li>)}
    </ul> : <EmptyNotice>{t('No signed-in devices to display.')}</EmptyNotice>}
    {revoke.isError && <p role="alert" className="mt-3 text-sm text-red-700">{t(messageOf(revoke.error))}</p>}
  </Panel>
}

function DeletionRequest() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [confirmationEmail, setConfirmationEmail] = useState('')
  const request = useMutation({ mutationFn: () => api('/account/deletion-requests', { method: 'POST', body: JSON.stringify({ confirmation: 'DELETE_ACCOUNT' }) }) })
  const matches = !!user?.email && confirmationEmail.trim().toLowerCase() === user.email.toLowerCase()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (matches) request.mutate()
  }

  return <Panel title={t('Request Account Deletion')}>
    <p className="mb-4 text-sm text-slate-600">{t('This submits an account deletion request. Consider whether you need to keep your listings, inquiries and reviews. The platform privacy policy and follow-up notices explain how these records are handled.')}</p>
    {request.isSuccess ? <p role="status" className="text-sm text-green-700">{t('Your deletion request has been submitted. Watch for a follow-up notice.')}</p> : <form onSubmit={submit} noValidate className="space-y-3">
      <label className="block text-sm font-medium">{t('Enter your account email to confirm this request')}
        <input className={inputClass} type="email" autoComplete="email" value={confirmationEmail} onChange={event => setConfirmationEmail(event.target.value)} placeholder={user?.email || ''} required />
      </label>
      {request.isError && <p role="alert" className="text-sm text-red-700">{t(messageOf(request.error))}</p>}
      <button type="submit" disabled={!matches || request.isPending} className="min-h-11 rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">{request.isPending ? t('Submitting…') : t('Submit Deletion Request')}</button>
    </form>}
  </Panel>
}

export function AccountControls() {
  return <div className="space-y-6">
    <NotificationsInbox />
    <NotificationControls />
    <SessionControls />
    <DeletionRequest />
  </div>
}
