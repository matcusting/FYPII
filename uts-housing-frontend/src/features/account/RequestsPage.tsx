import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, itemsOf, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { EmptyNotice, ErrorNotice, LoadingNotice, PageShell, Panel } from './shared'
import { formatDate, labelForStatus } from './format'

interface Inquiry {
  id: string
  listingId?: string
  listing?: { id?: string; title?: string }
  senderId?: string
  recipientId?: string
  sender?: { id?: string; name?: string }
  recipient?: { id?: string; name?: string }
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
  sender?: { id?: string; name?: string; displayName?: string }
  requester?: { id?: string; name?: string; displayName?: string }
  recipient?: { id?: string; name?: string; displayName?: string }
  status?: string
  message?: string
  createdAt?: string
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
  const isStudent = hasRole(user, 'STUDENT')
  const inquiries = useQuery({ queryKey: ['inquiries'], queryFn: () => api<unknown>('/inquiries'), enabled: !!user })
  // The requirements list PATCH /roommates/requests/:id, but omit the collection GET.
  const roommateRequests = useQuery({ queryKey: ['roommate-requests'], queryFn: () => api<unknown>('/roommates/requests'), enabled: !!user && isStudent })
  const respond = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACCEPTED' | 'DECLINED' }) => api(`/roommates/requests/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['roommate-requests'] }) },
  })

  const ownInquiries = itemsOf<Inquiry>(inquiries.data)
  const ownRequests = itemsOf<RoommateRequest>(roommateRequests.data)

  return <PageShell title="咨询与连接请求" description="在这里查看房源咨询及室友连接请求；接受连接前不会公开私人联系方式。">
    <div className="space-y-6">
      <Panel title="房源咨询" action={<Link to="/listings" className="text-sm font-medium text-[#203569] underline">浏览房源</Link>}>
        {inquiries.isPending ? <LoadingNotice /> : inquiries.isError ? <ErrorNotice error={inquiries.error} onRetry={() => void inquiries.refetch()} /> : ownInquiries.length ? <ul className="divide-y divide-slate-200">
          {ownInquiries.map(inquiry => {
            const listingId = inquiry.listingId || inquiry.listing?.id
            const otherName = inquiry.senderId === user?.id ? inquiry.recipient?.name : inquiry.sender?.name
            return <li key={inquiry.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{listingId ? <Link to={`/listings/${encodeURIComponent(listingId)}`} className="text-[#203569] underline underline-offset-2">{inquiry.listing?.title || '查看房源'}</Link> : inquiry.listing?.title || '房源咨询'}</h3>
                  {otherName && <p className="mt-1 text-sm text-slate-600">与 {otherName} 的咨询</p>}
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{labelForStatus(inquiry.status)}</span>
              </div>
              {inquiry.message && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{inquiry.message}</p>}
              <p className="mt-2 text-xs text-slate-500">{formatDate(inquiry.createdAt)}</p>
            </li>
          })}
        </ul> : <EmptyNotice>你目前没有房源咨询。可以从房源详情页联系发布者。</EmptyNotice>}
      </Panel>

      {isStudent && <Panel title="室友连接请求" action={<Link to="/roommates" className="text-sm font-medium text-[#203569] underline">查找室友</Link>}>
        {roommateRequests.isPending ? <LoadingNotice /> : roommateRequests.isError ? <ErrorNotice error={roommateRequests.error} onRetry={() => void roommateRequests.refetch()} /> : ownRequests.length ? <ul className="divide-y divide-slate-200">
          {ownRequests.map(request => {
            const incoming = isIncoming(request, user?.id)
            const other = incoming ? request.sender || request.requester : request.recipient
            const pending = (request.status || '').toUpperCase() === 'PENDING'
            return <li key={request.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{incoming ? '收到的请求' : '发出的请求'}{other && ` · ${other.displayName || other.name || '用户'}`}</h3>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(request.createdAt)}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{labelForStatus(request.status)}</span>
              </div>
              {request.message && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{request.message}</p>}
              {incoming && pending && <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={respond.isPending} onClick={() => respond.mutate({ id: request.id, status: 'ACCEPTED' })} className="min-h-11 rounded-lg bg-[#203569] px-4 py-2 text-sm font-semibold text-white hover:bg-[#172b59] disabled:opacity-60">接受</button>
                <button type="button" disabled={respond.isPending} onClick={() => respond.mutate({ id: request.id, status: 'DECLINED' })} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">婉拒</button>
              </div>}
            </li>
          })}
        </ul> : <EmptyNotice>目前没有室友连接请求。</EmptyNotice>}
        {respond.isError && <p role="alert" className="mt-3 text-sm text-red-700">{messageOf(respond.error)}</p>}
      </Panel>}
    </div>
  </PageShell>
}
