import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, itemsOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { ActionLink, EmptyNotice, ErrorNotice, LoadingNotice, PageShell, Panel } from './shared'
import { formatDate, labelForStatus } from './format'

interface InquirySummary {
  id: string
  status?: string
  createdAt?: string
  listing?: { id?: string; title?: string }
  listingId?: string
}

type Overview = Record<string, unknown>

function overviewNumber(data: Overview | undefined, ...keys: string[]): number | undefined {
  if (!data) return undefined
  for (const key of keys) {
    const raw = data[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (raw && typeof raw === 'object' && 'count' in raw && typeof raw.count === 'number') return raw.count
  }
  return undefined
}

export function DashboardPage() {
  const { user } = useAuth()
  const isAdmin = hasRole(user, 'ADMIN')
  const isStudent = hasRole(user, 'STUDENT')
  const isLandlord = hasRole(user, 'LANDLORD')
  const inquiries = useQuery({ queryKey: ['inquiries'], queryFn: () => api<unknown>('/inquiries'), enabled: !!user && !isAdmin })
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/overview'), enabled: isAdmin })
  const recentInquiries = itemsOf<InquirySummary>(inquiries.data).slice(0, 3)
  const adminQueues = [
    { label: '学生认证', to: '/admin/verifications', count: overviewNumber(overview.data, 'pendingVerifications', 'verificationsPending') },
    { label: '房源审核', to: '/admin/listings', count: overviewNumber(overview.data, 'pendingListings', 'listingsPending') },
    { label: '评价审核', to: '/admin/reviews', count: overviewNumber(overview.data, 'pendingReviews', 'reviewsPending') },
    { label: '用户举报', to: '/admin/reports', count: overviewNumber(overview.data, 'openReports', 'pendingReports') },
  ]

  return <PageShell title={`你好，${user?.name || user?.email || '用户'}`} description="从这里查看账户状态并继续处理房源、咨询和室友请求。">
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <Panel title="账户状态">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-slate-600">电子邮箱</dt><dd className="break-all text-right font-medium">{user?.email || '—'}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-slate-600">邮箱验证</dt><dd className="font-medium">{user?.emailVerified === undefined ? '请在账户资料中查看' : user.emailVerified ? '已验证' : '未验证'}</dd></div>
          {isStudent && <div className="flex justify-between gap-4"><dt className="text-slate-600">学生认证</dt><dd className="font-medium">{user?.studentVerified ? '已通过' : labelForStatus(user?.verificationStatus || 'UNVERIFIED')}</dd></div>}
        </dl>
        <div className="mt-5"><ActionLink to="/profile">编辑账户资料</ActionLink></div>
      </Panel>

      <Panel title="快捷入口">
        <nav aria-label="账户快捷入口" className="grid gap-2 text-sm sm:grid-cols-2">
          <Link className="rounded-lg border border-slate-200 p-3 font-medium hover:bg-slate-50" to="/listings">查找房源 →</Link>
          <Link className="rounded-lg border border-slate-200 p-3 font-medium hover:bg-slate-50" to="/favorites">我的收藏 →</Link>
          <Link className="rounded-lg border border-slate-200 p-3 font-medium hover:bg-slate-50" to="/requests">咨询与请求 →</Link>
          {(isStudent || isLandlord) && <Link className="rounded-lg border border-slate-200 p-3 font-medium hover:bg-slate-50" to="/my-listings">管理房源 →</Link>}
          {isStudent && <Link className="rounded-lg border border-slate-200 p-3 font-medium hover:bg-slate-50" to="/roommates/profile">室友资料与隐私 →</Link>}
          {isStudent && <Link className="rounded-lg border border-slate-200 p-3 font-medium hover:bg-slate-50" to="/roommates">寻找室友 →</Link>}
          {isStudent && user?.studentVerified && <Link className="rounded-lg border border-slate-200 p-3 font-medium hover:bg-slate-50" to="/reviews/mine">我的评价 →</Link>}
          {isAdmin && <Link className="rounded-lg border border-slate-200 p-3 font-medium hover:bg-slate-50" to="/admin">管理后台 →</Link>}
        </nav>
      </Panel>

      {isAdmin ? <Panel title="待处理事项">
        {overview.isPending ? <LoadingNotice /> : overview.isError ? <ErrorNotice error={overview.error} onRetry={() => void overview.refetch()} /> : <div className="grid gap-3 sm:grid-cols-2">
          {adminQueues.map(queue => <Link key={queue.to} to={queue.to} className="rounded-lg border border-slate-200 p-4 hover:bg-slate-50">
            <span className="block font-semibold">{queue.label}</span>
            <span className="mt-1 block text-sm text-slate-600">{queue.count === undefined ? '查看队列' : `${queue.count} 项待处理`}</span>
          </Link>)}
        </div>}
      </Panel> : <Panel title="近期咨询" action={<Link className="text-sm font-medium text-[#203569] underline" to="/requests">查看全部</Link>}>
        {inquiries.isPending ? <LoadingNotice /> : inquiries.isError ? <ErrorNotice error={inquiries.error} onRetry={() => void inquiries.refetch()} /> : recentInquiries.length ? <ul className="divide-y divide-slate-200">
          {recentInquiries.map(inquiry => <li key={inquiry.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span className="font-medium">{inquiry.listing?.title || '房源咨询'}</span>
            <span className="text-slate-600">{labelForStatus(inquiry.status)} · {formatDate(inquiry.createdAt)}</span>
          </li>)}
        </ul> : <EmptyNotice>目前没有咨询记录。</EmptyNotice>}
      </Panel>}
    </div>
  </PageShell>
}
