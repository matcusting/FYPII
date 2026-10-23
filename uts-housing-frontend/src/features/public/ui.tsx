import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../../lib/i18n'

export const fieldClass = 'mt-2 block w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#203569] focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100'
export const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#203569] px-5 py-3 font-semibold text-white transition hover:bg-[#1a2b56] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569] disabled:cursor-not-allowed disabled:opacity-60'
export const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-[#203569] transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569]'

export function AuthLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#f8f9fa] px-4 py-10">
      <div className="w-full max-w-[460px] rounded-xl bg-white p-7 shadow-[0_8px_24px_rgba(15,23,42,0.05)] sm:p-10">
        <Link to="/" className="text-sm font-semibold text-[#203569] underline-offset-4 hover:underline">← {t('System Login')}</Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#1f2937]">{t(title)}</h1>
        <p className="mt-2 text-slate-600">{t(description)}</p>
        <div className="mt-7">{children}</div>
      </div>
    </div>
  )
}

export function FormNotice({ error, success }: { error?: string | null; success?: string | null }) {
  const { t } = useI18n()
  if (!error && !success) return null
  return (
    <p role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>
      {t(error || success || '')}
    </p>
  )
}
