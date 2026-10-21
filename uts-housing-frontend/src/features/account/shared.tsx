import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'

export function PageShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const { user } = useAuth()
  const landlord = hasRole(user, 'LANDLORD') && !hasRole(user, 'STUDENT') && !hasRole(user, 'ADMIN')
  return (
    <div className={landlord ? 'min-w-0 flex-1 bg-white px-5 py-8 text-[#0f172a] sm:px-8 lg:p-10' : 'min-h-[70vh] bg-[#f8f9fa] px-4 py-7 text-[#1f2937] sm:px-6'}>
      <div className={landlord ? 'w-full' : 'mx-auto max-w-[1000px]'}>
        <div className={landlord ? 'mb-8 border-b border-gray-100 pb-4' : 'mb-6'}>
          <h1 className={landlord ? 'text-[1.4rem] font-bold' : 'text-2xl font-bold sm:text-3xl'}>{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm text-gray-500">{description}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.04)] sm:p-6">
      {(title || action) && <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
        {title && <h2 className="text-lg font-bold text-[#1f2937]">{title}</h2>}
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
  return <p className="rounded-lg border border-gray-200 bg-[#f8f9fa] p-5 text-sm text-gray-600">{children}</p>
}

export function LoadingNotice() {
  return <p role="status" className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-600">正在加载…</p>
}

export function ActionLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex min-h-11 items-center rounded-lg bg-[#203569] px-4 py-2 text-sm font-semibold text-white hover:bg-[#172b59] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569]">{children}</Link>
}
