import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, itemsOf, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { ErrorNotice, LoadingNotice } from './shared'
import { formatDate, labelForStatus } from './format'

interface Person { id?: string; name?: string; displayName?: string }
interface Inquiry {
  id: string
  listingId?: string
  listing?: { id?: string; title?: string }
  senderId?: string
  recipientId?: string
  sender?: Person
  recipient?: Person
  message?: string
  status?: string
  createdAt?: string
}
interface RoommateRequest {
  id: string
  senderId?: string
  requesterId?: string
  recipientId?: string
  direction?: string
  sender?: Person
  requester?: Person
  recipient?: Person
  status?: string
  message?: string
  createdAt?: string
}
interface Thread {
  id: string
  kind: 'inquiry' | 'roommate'
  name: string
  subtitle: string
  message: string
  status?: string
  createdAt?: string
  incoming: boolean
  listingId?: string
  requestId?: string
}

function initials(name: string) {
  return name.trim().split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase() || 'UT'
}

function isIncoming(request: RoommateRequest, userId?: string) {
  if (!userId) return false
  if (request.recipientId) return request.recipientId === userId
  if (request.recipient?.id) return request.recipient.id === userId
  return request.direction?.toUpperCase() === 'INCOMING'
}

export function RequestsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState('')
  const isStudent = hasRole(user, 'STUDENT')
  const isLandlord = hasRole(user, 'LANDLORD') && !isStudent && !hasRole(user, 'ADMIN')
  const inquiries = useQuery({ queryKey: ['inquiries'], queryFn: () => api<unknown>('/inquiries'), enabled: !!user })
  const roommateRequests = useQuery({ queryKey: ['roommate-requests'], queryFn: () => api<unknown>('/roommates/requests'), enabled: !!user && isStudent })
  const respond = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACCEPTED' | 'DECLINED' }) => api('/roommates/requests/' + encodeURIComponent(id), {
      method: 'PATCH', body: JSON.stringify({ status }),
    }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['roommate-requests'] }) },
  })

  const threads: Thread[] = [
    ...itemsOf<Inquiry>(inquiries.data).map(inquiry => {
      const senderId = inquiry.senderId || inquiry.sender?.id
      const incoming = senderId ? senderId !== user?.id : isLandlord
      const other = incoming ? inquiry.sender : inquiry.recipient
      return {
        id: 'inquiry-' + inquiry.id, kind: 'inquiry' as const,
        name: other?.displayName || other?.name || (isLandlord ? 'Student' : 'Landlord'),
        subtitle: inquiry.listing?.title || 'Property inquiry',
        message: inquiry.message || '', status: inquiry.status,
        createdAt: inquiry.createdAt, incoming,
        listingId: inquiry.listingId || inquiry.listing?.id,
      }
    }),
    ...itemsOf<RoommateRequest>(roommateRequests.data).map(request => {
      const incoming = isIncoming(request, user?.id)
      const other = incoming ? request.sender || request.requester : request.recipient
      return {
        id: 'roommate-' + request.id, kind: 'roommate' as const,
        name: other?.displayName || other?.name || 'Student',
        subtitle: incoming ? 'Roommate connection request' : 'Sent roommate request',
        message: request.message || '', status: request.status,
        createdAt: request.createdAt, incoming, requestId: request.id,
      }
    }),
  ].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  const selected = threads.find(thread => thread.id === selectedId) || threads[0]
  const listLoading = inquiries.isPending || (isStudent && roommateRequests.isPending)

  return <div className={isLandlord ? 'min-w-0 flex-1 bg-white text-[#1f2937]' : 'min-h-screen bg-[#f8f9fa] px-4 pb-20 text-[#1f2937] sm:px-6'}>
    <div className={isLandlord ? 'w-full' : 'mx-auto max-w-[1000px]'}>
      {!isLandlord && <Link to="/dashboard" className="mb-4 inline-block text-sm font-bold text-gray-500 hover:text-[#203569]">← Back to Dashboard</Link>}
      <div className={['overflow-hidden border border-gray-100 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]', isLandlord ? '' : 'rounded-xl'].join(' ')}>
        <div className={['grid md:grid-cols-[300px_minmax(0,1fr)]', isLandlord ? 'min-h-[510px]' : 'min-h-[648px] lg:grid-cols-[320px_minmax(0,1fr)]'].join(' ')}>
          <aside className="border-b border-gray-200 bg-[#fafbfc] md:border-b-0 md:border-r" aria-label="Conversations">
            <div className={['flex items-center justify-between border-b border-gray-200 bg-white px-6', isLandlord ? 'min-h-[68px]' : 'min-h-[76px]'].join(' ')}><h1 className={isLandlord ? 'text-lg font-bold' : 'text-xl font-bold'}>{isLandlord ? 'Student Inquiries' : 'Messages'}</h1><span className="text-xs font-semibold text-gray-500">{threads.length || ''}</span></div>
            {(inquiries.isError || roommateRequests.isError) && <div className="p-3"><ErrorNotice error={inquiries.error || roommateRequests.error} onRetry={() => { void inquiries.refetch(); if (isStudent) void roommateRequests.refetch() }} /></div>}
            {listLoading ? <div className="p-4"><LoadingNotice /></div> : threads.length ? <ul className="max-h-[570px] overflow-y-auto">
              {threads.map(thread => <li key={thread.id}>
                <button type="button" onClick={() => setSelectedId(thread.id)} className={['flex min-h-[80px] w-full items-center gap-4 border-b border-gray-100 px-5 py-4 text-left transition hover:bg-[#eef2f7]', selected?.id === thread.id ? 'border-l-4 border-l-[#203569] bg-[#eef2f7] pl-4' : ''].join(' ')} aria-current={selected?.id === thread.id ? 'true' : undefined}>
                  <span aria-hidden="true" className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold', selected?.id === thread.id ? 'bg-[#203569] text-white' : 'bg-[#e2e8f0] text-gray-600'].join(' ')}>{initials(thread.name)}</span>
                  <span className="min-w-0 flex-1"><span className={['block truncate text-sm font-bold', selected?.id === thread.id ? 'text-[#203569]' : 'text-gray-800'].join(' ')}>{thread.name}</span><span className="mt-1 block truncate text-xs text-gray-500">{thread.subtitle}</span></span>
                </button>
              </li>)}
            </ul> : <p className="p-6 text-sm text-gray-500">No conversations yet. {isStudent ? 'Explore listings or roommates to get started.' : 'Student inquiries will appear here.'}</p>}
            {isStudent && <div className="flex gap-4 p-5 text-xs font-bold text-[#203569]"><Link to="/listings" className="hover:underline">Browse Housing →</Link><Link to="/roommates" className="hover:underline">Find Roommates →</Link></div>}
          </aside>
          <section className={['flex min-w-0 flex-col', isLandlord ? 'min-h-[510px]' : 'min-h-[648px]'].join(' ')} aria-label="Conversation details">
            {selected ? <>
              <header className={['flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4', isLandlord ? 'min-h-[81px]' : 'min-h-[92px]'].join(' ')}>
                <div className="flex items-center gap-4"><span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-[#203569] text-sm font-bold text-white">{initials(selected.name)}</span><div><h2 className="font-bold">{selected.name}</h2><p className="text-xs text-gray-500">{selected.kind === 'roommate' ? 'Student' : isLandlord ? 'Student inquiry' : 'Property inquiry'} · {labelForStatus(selected.status)}</p></div></div>
                {selected.listingId && <Link to={'/listings/' + encodeURIComponent(selected.listingId)} className="rounded-lg border border-[#203569] px-4 py-2 text-xs font-bold text-[#203569] hover:bg-[#f4f7fb]">View Property</Link>}
              </header>
              <div className="flex-1 bg-[#f8f9fa] p-6">
                <p className="mb-5 text-center text-xs text-gray-400">{formatDate(selected.createdAt)}</p>
                {selected.message ? <div className={['max-w-[440px] rounded-2xl p-4 text-sm leading-6 shadow-sm', selected.incoming ? 'border border-gray-200 bg-white text-gray-800' : 'ml-auto bg-[#203569] text-white'].join(' ')}>{selected.message}</div> : <p className="text-center text-sm text-gray-500">No message text was included with this request.</p>}
                {selected.kind === 'roommate' && selected.incoming && selected.status?.toUpperCase() === 'PENDING' && selected.requestId && <div className="mt-5 flex gap-3"><button type="button" disabled={respond.isPending} onClick={() => respond.mutate({ id: selected.requestId!, status: 'ACCEPTED' })} className="rounded-lg bg-[#203569] px-4 py-2 text-sm font-bold text-white hover:bg-[#1a2b56] disabled:opacity-50">Accept Request</button><button type="button" disabled={respond.isPending} onClick={() => respond.mutate({ id: selected.requestId!, status: 'DECLINED' })} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Decline</button></div>}
                {respond.isError && <p role="alert" className="mt-3 text-sm text-red-700">{messageOf(respond.error)}</p>}
              </div>
              <div className={['flex items-center gap-3 border-t border-gray-200 bg-white px-4', isLandlord ? 'min-h-[74px]' : 'min-h-[80px]'].join(' ')}><input aria-label="Reply" readOnly value="" placeholder="Replies are unavailable for this conversation" className="min-h-11 flex-1 cursor-not-allowed rounded-full border border-[#dbe4ff] bg-[#f4f7fb] px-5 text-sm text-gray-500 placeholder:text-gray-400" /><span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-[#94a3b8] text-lg text-white">➤</span></div>
            </> : <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-gray-500">Select a conversation to see its details.</div>}
          </section>
        </div>
      </div>
    </div>
  </div>
}
