import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

const navigation = [
  { to: '/admin', text: '总览', end: true },
  { to: '/admin/verifications', text: '学生认证' },
  { to: '/admin/listings', text: '房源审核' },
  { to: '/admin/reviews', text: '评价审核' },
  { to: '/admin/reports', text: '举报处理' },
  { to: '/admin/accounts', text: '账号管理' },
  { to: '/admin/campuses', text: '校区与域名' },
]

export function AdminShell({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="container py-8 sm:py-10" aria-labelledby="admin-page-title">
      <div className="mb-7">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-800">管理后台</p>
        <h1 id="admin-page-title" className="page-heading">{title}</h1>
        <p className="mt-2 max-w-3xl text-slate-600">{description}</p>
      </div>
      <nav aria-label="管理后台导航" className="mb-7 flex flex-wrap gap-2">
        {navigation.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) =>
            `rounded-lg px-3 py-2 text-sm font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${isActive ? 'bg-blue-800 text-white' : 'border border-slate-300 bg-white text-slate-800 hover:bg-blue-50'}`
          }>{item.text}</NavLink>
        ))}
      </nav>
      {children}
    </section>
  )
}

export function QueryState({ loading, error, empty, emptyText, onRetry }: {
  loading: boolean
  error: string | null
  empty: boolean
  emptyText: string
  onRetry?: () => void
}) {
  if (loading) return <div role="status" className="card p-6 text-slate-700">正在加载数据…</div>
  if (error) return (
    <div role="alert" className="card border-red-200 bg-red-50 p-6 text-red-900">
      <p>{error}</p>
      {onRetry && <button type="button" className="button button-secondary mt-4" onClick={onRetry}>重试</button>}
    </div>
  )
  if (empty) return <div role="status" className="card p-6 text-slate-600">{emptyText}</div>
  return null
}

export function Notice({ error, success }: { error?: string | null; success?: string | null }) {
  if (!error && !success) return null
  return (
    <p role={error ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
      {error || success}
    </p>
  )
}
