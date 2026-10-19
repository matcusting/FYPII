import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { hasRole, useAuth } from '../../lib/auth'

export const inputClass = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'
export const buttonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-55'
export const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-55'

export function RoommateShell({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
    <div className="mx-auto max-w-6xl">
      <div className="mb-7 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="mb-1 text-sm font-semibold text-emerald-800">室友匹配</p><h1 className="text-3xl font-bold tracking-tight">{title}</h1><p className="mt-2 max-w-2xl text-slate-600">{description}</p></div>
        <nav aria-label="室友页面" className="flex flex-wrap gap-2 text-sm font-medium">
          <Link className="rounded-lg px-3 py-2 text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-700" to="/roommates">查看匹配</Link>
          <Link className="rounded-lg px-3 py-2 text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-700" to="/roommates/profile">我的室友资料</Link>
        </nav>
      </div>
      {children}
    </div>
  </div>
}

export function StudentGate({ verified = false, children }: { verified?: boolean; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <RoommateShell title="正在加载" description="正在检查登录状态。"><p role="status">请稍候…</p></RoommateShell>
  if (!user) return <RoommateShell title="请先登录" description="登录后可管理室友资料及匹配请求。"><Link className={buttonClass} to="/login?next=%2Froommates">前往登录</Link></RoommateShell>
  if (!hasRole(user, 'student')) return <RoommateShell title="无权访问" description="室友功能仅供学生使用。" />
  if (verified && !user.studentVerified) return <RoommateShell title="需要学生认证" description="请先完成学生身份认证，才能查看匹配和发送连接请求。"><Link className={buttonClass} to="/profile">查看认证状态</Link></RoommateShell>
  return <>{children}</>
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) {
  const className = tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-sky-200 bg-sky-50 text-sky-900'
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-4 text-sm ${className}`}>{children}</div>
}
