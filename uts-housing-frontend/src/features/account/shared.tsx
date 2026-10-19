import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { messageOf } from '../../lib/api'

export function PageShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm text-slate-600 sm:text-base">{description}</p>}
        </div>
        {children}
      </div>
    </main>
  )
}

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      {(title || action) && <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        {title && <h2 className="text-lg font-semibold">{title}</h2>}
        {action}
      </div>}
      {children}
    </section>
  )
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
    <p>{messageOf(error)}</p>
    {onRetry && <button type="button" onClick={onRetry} className="mt-2 font-semibold underline underline-offset-2">重试</button>}
  </div>
}

export function EmptyNotice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">{children}</p>
}

export function LoadingNotice() {
  return <p role="status" className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">正在加载…</p>
}

export function ActionLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex min-h-11 items-center rounded-lg bg-[#203569] px-4 py-2 text-sm font-semibold text-white hover:bg-[#172b59] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569]">{children}</Link>
}
