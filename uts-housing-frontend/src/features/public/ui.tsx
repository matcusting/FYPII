import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export const fieldClass = 'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100'
export const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-800 px-5 py-3 font-semibold text-white transition hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-800 disabled:cursor-not-allowed disabled:opacity-60'
export const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-800'

export function AuthLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-7xl items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <Link to="/" className="text-sm font-semibold text-blue-800 underline-offset-4 hover:underline">← 返回首页</Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-2 text-slate-600">{description}</p>
        <div className="mt-7">{children}</div>
      </div>
    </div>
  )
}

export function FormNotice({ error, success }: { error?: string | null; success?: string | null }) {
  if (!error && !success) return null
  return (
    <p role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>
      {error || success}
    </p>
  )
}
