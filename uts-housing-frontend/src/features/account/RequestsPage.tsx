import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
interface ConversationMessage { id: string; senderId: string; body: string; createdAt?: string }
interface PageResult<T> { items: T[]; page?: number; pages?: number }
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
  inquiryId?: string
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
  const [reply, setReply] = useState('')
  const [replyError, setReplyError] = useState('')
  const isStudent = hasRole(user, 'STUDENT')
  const isLandlord = hasRole(user, 'LANDLORD') && !isStudent && !hasRole(user, 'ADMIN')
  const inquiries = useInfiniteQuery({
    queryKey: ['inquiries'],
    queryFn: ({ pageParam }) => api<PageResult<Inquiry>>(`/inquiries?page=${pageParam}&limit=20`),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => last.pages && pages.length < last.pages ? pages.length + 1 : undefined,
    enabled: !!user,
  })
  const roommateRequests = useInfiniteQuery({
    queryKey: ['roommate-requests'],
    queryFn: ({ pageParam }) => api<PageResult<RoommateRequest>>(`/roommates/requests?page=${pageParam}&limit=20`),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => last.pages && pages.length < last.pages ? pages.length + 1 : undefined,
    enabled: !!user && isStudent,
  })
  const respond = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACCEPTED' | 'DECLINED' }) => api('/roommates/requests/' + encodeURIComponent(id), {
      method: 'PATCH', body: JSON.stringify({ status }),
    }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['roommate-requests'] }) },
  })

  const threads: Thread[] = [
    ...(inquiries.data?.pages.flatMap(page => itemsOf<Inquiry>(page)) || []).map(inquiry => {
      const senderId = inquiry.senderId || inquiry.sender?.id
      const incoming = senderId ? senderId !== user?.id : isLandlord
      const other = incoming ? inquiry.sender : inquiry.recipient
      return {
        id: 'inquiry-' + inquiry.id, kind: 'inquiry' as const,
        name: other?.displayName || other?.name || (isLandlord ? 'Student' : 'Landlord'),
        subtitle: inquiry.listing?.title || 'Property inquiry',
        message: inquiry.message || '', status: inquiry.status,
        createdAt: inquiry.createdAt, incoming,
        inquiryId: inquiry.id,
        listingId: inquiry.listingId || inquiry.listing?.id,
      }
    }),
    ...(roommateRequests.data?.pages.flatMap(page => itemsOf<RoommateRequest>(page)) || []).map(request => {
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
  const canReply = !!selected && (selected.kind === 'inquiry' || selected.status?.toUpperCase() === 'ACCEPTED')
  const messagePath = selected?.kind === 'inquiry' && selected.inquiryId
    ? `/inquiries/${encodeURIComponent(selected.inquiryId)}/messages`
    : selected?.kind === 'roommate' && selected.requestId
      ? `/roommates/requests/${encodeURIComponent(selected.requestId)}/messages`
      : ''
  const messages = useInfiniteQuery({
    queryKey: ['conversation-messages', selected?.id],
    queryFn: ({ pageParam }) => api<PageResult<ConversationMessage>>(`${messagePath}?page=${pageParam}&limit=20`),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => last.pages && pages.length < last.pages ? pages.length + 1 : undefined,
    enabled: !!messagePath && canReply, retry: false, refetchInterval: 5000,
  })
  const sendReply = useMutation({
    mutationFn: (body: string) => api(messagePath, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: async () => { setReply(''); setReplyError(''); await queryClient.invalidateQueries({ queryKey: ['conversation-messages', selected?.id] }); await queryClient.invalidateQueries({ queryKey: ['inquiries'] }) },
  })
  const conversationMessages = messages.data?.pages.slice().reverse().flatMap(page => itemsOf<ConversationMessage>(page)) || []
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
                <button type="button" onClick={() => { setSelectedId(thread.id); setReply(''); setReplyError('') }} className={['flex min-h-[80px] w-full items-center gap-4 border-b border-gray-100 px-5 py-4 text-left transition hover:bg-[#eef2f7]', selected?.id === thread.id ? 'border-l-4 border-l-[#203569] bg-[#eef2f7] pl-4' : ''].join(' ')} aria-current={selected?.id === thread.id ? 'true' : undefined}>
                  <span aria-hidden="true" className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold', selected?.id === thread.id ? 'bg-[#203569] text-white' : 'bg-[#e2e8f0] text-gray-600'].join(' ')}>{initials(thread.name)}</span>
                  <span className="min-w-0 flex-1"><span className={['block truncate text-sm font-bold', selected?.id === thread.id ? 'text-[#203569]' : 'text-gray-800'].join(' ')}>{thread.name}</span><span className="mt-1 block truncate text-xs text-gray-500">{thread.subtitle}</span></span>
                </button>
              </li>)}
            </ul> : <p className="p-6 text-sm text-gray-500">No conversations yet. {isStudent ? 'Explore listings or roommates to get started.' : 'Student inquiries will appear here.'}</p>}
            {(inquiries.hasNextPage || roommateRequests.hasNextPage) && <div className="flex flex-wrap gap-2 border-t border-gray-100 p-3 text-xs font-semibold text-[#203569]">
              {inquiries.hasNextPage && <button type="button" disabled={inquiries.isFetchingNextPage} onClick={() => void inquiries.fetchNextPage()} className="rounded-lg border border-[#203569] px-3 py-2 disabled:opacity-50">{inquiries.isFetchingNextPage ? 'Loading…' : 'More inquiries'}</button>}
              {roommateRequests.hasNextPage && <button type="button" disabled={roommateRequests.isFetchingNextPage} onClick={() => void roommateRequests.fetchNextPage()} className="rounded-lg border border-[#203569] px-3 py-2 disabled:opacity-50">{roommateRequests.isFetchingNextPage ? 'Loading…' : 'More roommate requests'}</button>}
            </div>}
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
                {messages.hasNextPage && <div className="mb-5 text-center"><button type="button" className="text-xs font-semibold text-[#203569] underline disabled:opacity-50" disabled={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>{messages.isFetchingNextPage ? 'Loading…' : 'Load older messages'}</button></div>}
                {conversationMessages.length ? <div className="space-y-4">{conversationMessages.map(message => <div key={message.id} className={['max-w-[440px] rounded-2xl p-4 text-sm leading-6 shadow-sm', message.senderId === user?.id ? 'ml-auto bg-[#203569] text-white' : 'border border-gray-200 bg-white text-gray-800'].join(' ')}><p className="whitespace-pre-wrap break-words">{message.body}</p>{message.createdAt && <span className="mt-2 block text-[11px] opacity-70">{formatDate(message.createdAt)}</span>}</div>)}</div> : selected.message ? <div className={['max-w-[440px] rounded-2xl p-4 text-sm leading-6 shadow-sm', selected.incoming ? 'border border-gray-200 bg-white text-gray-800' : 'ml-auto bg-[#203569] text-white'].join(' ')}>{selected.message}</div> : <p className="text-center text-sm text-gray-500">No message text was included with this request.</p>}
                {selected.kind === 'roommate' && selected.incoming && selected.status?.toUpperCase() === 'PENDING' && selected.requestId && <div className="mt-5 flex gap-3"><button type="button" disabled={respond.isPending} onClick={() => respond.mutate({ id: selected.requestId!, status: 'ACCEPTED' })} className="rounded-lg bg-[#203569] px-4 py-2 text-sm font-bold text-white hover:bg-[#1a2b56] disabled:opacity-50">Accept Request</button><button type="button" disabled={respond.isPending} onClick={() => respond.mutate({ id: selected.requestId!, status: 'DECLINED' })} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Decline</button></div>}
                {respond.isError && <p role="alert" className="mt-3 text-sm text-red-700">{messageOf(respond.error)}</p>}
                {messages.isError && canReply && <p role="alert" className="mt-3 text-sm text-red-700">Could not load replies: {messageOf(messages.error)}</p>}
              </div>
              <div className="border-t border-gray-200 bg-white px-4 py-3">{canReply ? <form onSubmit={event => { event.preventDefault(); const body = reply.trim(); if (!body || body.length > 2000) { setReplyError('Enter a reply between 1 and 2,000 characters.'); return } setReplyError(''); sendReply.mutate(body) }} className="flex items-center gap-3"><input aria-label="Reply" value={reply} maxLength={2000} onChange={event => setReply(event.target.value)} placeholder="Write a reply" className="min-h-11 flex-1 rounded-full border border-[#dbe4ff] bg-[#f4f7fb] px-5 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-[#203569]" /><button type="submit" aria-label="Send reply" disabled={sendReply.isPending || messages.isError} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#203569] text-lg text-white hover:bg-[#1a2b56] disabled:opacity-50">➤</button></form> : <p className="py-3 text-center text-xs text-gray-500">Accept the roommate request before messaging.</p>}{replyError && <p role="alert" className="mt-2 text-xs text-red-700">{replyError}</p>}{sendReply.isError && <p role="alert" className="mt-2 text-xs text-red-700">{messageOf(sendReply.error)}</p>}</div>
            </> : <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-gray-500">Select a conversation to see its details.</div>}
          </section>
        </div>
      </div>
    </div>
  </div>
}
