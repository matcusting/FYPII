import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

const navigation = [
  { to: '/admin', text: 'Overview', icon: '▦', end: true },
  { to: '/admin/verifications', text: 'Student Verification', icon: '✓' },
  { to: '/admin/listings', text: 'Listing Review', icon: '⌂' },
  { to: '/admin/reviews', text: 'Review Moderation', icon: '★' },
  { to: '/admin/reports', text: 'Reports', icon: '⚑' },
  { to: '/admin/accounts', text: 'Accounts', icon: '♙' },
  { to: '/admin/campuses', text: 'Campuses & Domains', icon: '◉' },
]

export function AdminShell({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="mx-4 my-8 max-w-[1150px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)] md:min-h-[550px]" aria-labelledby="admin-page-title">
      <div className="grid md:grid-cols-[235px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-[#f8f9fb] p-4 md:border-b-0 md:border-r md:p-6">
          <p className="mb-3 px-3 text-sm font-bold uppercase tracking-wide text-[#203569]">Admin Portal</p>
          <nav aria-label="Admin navigation" className="flex flex-wrap gap-1.5 md:flex-col">
            {navigation.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569] ${isActive ? 'bg-[#dfe6ff] text-[#1d4ed8]' : 'text-slate-600 hover:bg-slate-100 hover:text-[#203569]'}`
              }><span aria-hidden="true" className="w-5 text-center">{item.icon}</span>{item.text}</NavLink>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 p-5 sm:p-8 md:p-10">
          <div className="mb-7 border-b border-slate-200 pb-5">
            <h1 id="admin-page-title" className="text-2xl font-bold text-slate-900">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          </div>
          {children}
        </div>
      </div>
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
  if (loading) return <div role="status" className="card p-6 text-slate-700">Loading data…</div>
  if (error) return (
    <div role="alert" className="card border-red-200 bg-red-50 p-6 text-red-900">
      <p>{error}</p>
      {onRetry && <button type="button" className="button button-secondary mt-4" onClick={onRetry}>Retry</button>}
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
