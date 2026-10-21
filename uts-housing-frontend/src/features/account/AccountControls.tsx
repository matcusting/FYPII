import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, messageOf } from '../../lib/api'
import { useAuth } from '../../lib/auth'
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

  return <Panel title="Email Notifications">
    <p className="mb-4 text-sm text-slate-600">You can turn off these optional emails. Account security, email verification and password reset messages will still be sent.</p>
    {preferences.isPending ? <LoadingNotice /> : preferences.isError ? <ErrorNotice error={preferences.error} onRetry={() => void preferences.refetch()} /> : values && <form onSubmit={submit} className="space-y-4">
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={values.emailInquiryUpdates} onChange={event => setEdits(previous => ({ ...previous, emailInquiryUpdates: event.target.checked }))} /><span>Property inquiry emails</span></label>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={values.emailConnectionRequests} onChange={event => setEdits(previous => ({ ...previous, emailConnectionRequests: event.target.checked }))} /><span>Roommate connection request emails</span></label>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={values.emailProductUpdates} onChange={event => setEdits(previous => ({ ...previous, emailProductUpdates: event.target.checked }))} /><span>Product update emails</span></label>
      {save.isError && <p role="alert" className="text-sm text-red-700">{messageOf(save.error)}</p>}
      {save.isSuccess && !Object.keys(edits).length && <p role="status" className="text-sm text-green-700">Notification settings saved.</p>}
      <button type="submit" disabled={save.isPending || !Object.keys(edits).length} className="min-h-11 rounded-lg bg-[#203569] px-4 py-2 text-sm font-semibold text-white hover:bg-[#172b59] disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save Notification Settings'}</button>
    </form>}
  </Panel>
}

function SessionControls() {
  const queryClient = useQueryClient()
  const sessions = useQuery({ queryKey: ['account-sessions'], queryFn: async () => parseSessions(await api<unknown>('/auth/sessions')) })
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['account-sessions'] }) },
  })

  return <Panel title="Signed-in Devices">
    <p className="mb-4 text-sm text-slate-600">Review your active sessions. To end the session on this device, use Logout at the top of the page.</p>
    {sessions.isPending ? <LoadingNotice /> : sessions.isError ? <ErrorNotice error={sessions.error} onRetry={() => void sessions.refetch()} /> : sessions.data?.length ? <ul className="divide-y divide-slate-200">
      {sessions.data.map(session => <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold">{session.device || session.userAgent || 'Unknown device'} {session.current && <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Current device</span>}</p>
          <p className="mt-1 text-xs text-slate-600">Last active: {formatDate(session.lastActiveAt || session.createdAt)}</p>
        </div>
        {!session.current && <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(session.id)} className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" aria-label={`End session on ${session.device || 'this device'}`}>End Session</button>}
      </li>)}
    </ul> : <EmptyNotice>No signed-in devices to display.</EmptyNotice>}
    {revoke.isError && <p role="alert" className="mt-3 text-sm text-red-700">{messageOf(revoke.error)}</p>}
  </Panel>
}

function DeletionRequest() {
  const { user } = useAuth()
  const [confirmationEmail, setConfirmationEmail] = useState('')
  const request = useMutation({ mutationFn: () => api('/account/deletion-requests', { method: 'POST', body: JSON.stringify({ confirmation: 'DELETE_ACCOUNT' }) }) })
  const matches = !!user?.email && confirmationEmail.trim().toLowerCase() === user.email.toLowerCase()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (matches) request.mutate()
  }

  return <Panel title="Request Account Deletion">
    <p className="mb-4 text-sm text-slate-600">This submits an account deletion request. Consider whether you need to keep your listings, inquiries and reviews. The platform privacy policy and follow-up notices explain how these records are handled.</p>
    {request.isSuccess ? <p role="status" className="text-sm text-green-700">Your deletion request has been submitted. Watch for a follow-up notice.</p> : <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium">Enter your account email to confirm this request
        <input className={inputClass} type="email" autoComplete="email" value={confirmationEmail} onChange={event => setConfirmationEmail(event.target.value)} placeholder={user?.email || ''} required />
      </label>
      {request.isError && <p role="alert" className="text-sm text-red-700">{messageOf(request.error)}</p>}
      <button type="submit" disabled={!matches || request.isPending} className="min-h-11 rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">{request.isPending ? 'Submitting…' : 'Submit Deletion Request'}</button>
    </form>}
  </Panel>
}

export function AccountControls() {
  return <div className="space-y-6">
    <NotificationControls />
    <SessionControls />
    <DeletionRequest />
  </div>
}
