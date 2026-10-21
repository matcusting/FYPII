import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, messageOf } from '../../lib/api'
import { AdminShell, QueryState } from './shared'
import { asRecord, type DataRecord } from './data'

const metrics = [
  { label: '待审核学生认证', path: '/admin/verifications', keys: ['pendingVerifications', 'pendingStudentVerifications', 'verificationsPending', 'studentVerifications'] },
  { label: '房东账号', path: '/admin/accounts', keys: ['landlordAccounts', 'landlords', 'landlordCount'] },
  { label: '待审核房源', path: '/admin/listings', keys: ['pendingListings', 'listingsPending'] },
  { label: '待审核评价', path: '/admin/reviews', keys: ['pendingReviews', 'reviewsPending'] },
  { label: '未处理举报', path: '/admin/reports', keys: ['openReports', 'pendingReports', 'reportsOpen'] },
] as const

function metricValue(data: DataRecord | null, keys: readonly string[]): string {
  const sections = [data, asRecord(data?.counts), asRecord(data?.metrics), asRecord(data?.pending)]
  for (const section of sections) {
    for (const key of keys) {
      const value = section?.[key]
      if (typeof value === 'number' && Number.isFinite(value)) return new Intl.NumberFormat('zh-CN').format(value)
      if (typeof value === 'string' && /^\d+$/.test(value)) return new Intl.NumberFormat('zh-CN').format(Number(value))
    }
  }
  return '—'
}

export function AdminOverviewPage() {
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<unknown>('/admin/overview') })
  const data = asRecord(overview.data)

  return (
    <AdminShell title="管理总览" description="查看待处理工作并进入相应审核队列。所有数字均来自管理 API。">
      <QueryState loading={overview.isPending} error={overview.error ? messageOf(overview.error) : null} empty={!data} emptyText="管理 API 尚未返回总览数据。" onRetry={() => { void overview.refetch() }} />
      {data && !overview.error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map(metric => (
            <Link key={metric.label} to={metric.path} className="card block p-5 no-underline transition hover:border-[#a8bde8] hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569]">
              <span className="block text-sm font-medium text-slate-600">{metric.label}</span>
              <strong className="mt-3 block text-3xl text-[#203569]">{metricValue(data, metric.keys)}</strong>
              <span className="mt-4 block text-sm font-semibold text-[#203569]">查看详情 →</span>
            </Link>
          ))}
        </div>
      )}
    </AdminShell>
  )
}
