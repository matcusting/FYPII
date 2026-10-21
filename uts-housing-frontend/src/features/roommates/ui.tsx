import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { hasRole, useAuth } from '../../lib/auth'

// The palette and card shape follow the original student portal.
export const inputClass = 'mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2.5 text-gray-800 outline-none transition-colors focus:border-[#203569] focus-visible:ring-2 focus-visible:ring-[#203569]/15'
export const buttonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#15803d] px-6 py-3 text-base font-bold text-white shadow-sm transition hover:bg-green-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803d] disabled:cursor-not-allowed disabled:opacity-55'
export const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-[#203569] bg-white px-5 py-2.5 text-base font-bold text-[#203569] transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#203569] disabled:cursor-not-allowed disabled:opacity-55'
export const originalCardClass = 'overflow-hidden rounded-xl border border-gray-100 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]'

export function RoommateShell({ title, description, children }: { title?: string; description?: string; children?: ReactNode }) {
  return <div className="bg-[#f8f9fa] pb-20 font-sans text-[#1f2937]">
    <div className="mx-auto w-full max-w-[1000px] space-y-8 px-4 sm:px-6 lg:px-0">
      {title && <section className={originalCardClass}>
        <div className="bg-[#15803d] px-8 py-4 text-white"><h1 className="text-[1.1rem] font-bold tracking-wide">{title}</h1></div>
        {(description || children) && <div className="p-8">
          {description && <p className="text-sm leading-6 text-gray-600">{description}</p>}
          <nav aria-label="Roommate pages" className="mt-5 flex flex-wrap gap-3 text-sm font-bold">
            <Link className="text-[#203569] underline-offset-4 hover:underline" to="/roommates">Find Roommates</Link>
            <Link className="text-[#203569] underline-offset-4 hover:underline" to="/roommates/profile">My Lifestyle Profile</Link>
          </nav>
          {children && <div className="mt-6">{children}</div>}
        </div>}
      </section>}
      {!title && children}
    </div>
  </div>
}

export function StudentGate({ verified = false, children }: { verified?: boolean; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <RoommateShell title="Loading" description="Checking your login status."><p role="status">Please wait…</p></RoommateShell>
  if (!user) return <RoommateShell title="Sign in required" description="Sign in to manage your lifestyle profile and view roommate matches."><Link className={buttonClass} to="/login?next=%2Froommates">Sign in</Link></RoommateShell>
  if (!hasRole(user, 'student')) return <RoommateShell title="Access denied" description="Roommate matching is available to students only." />
  if (verified && !user.studentVerified) return <RoommateShell title="Student verification required" description="Verify your student status before viewing matches or sending connection requests."><Link className={buttonClass} to="/profile">View verification status</Link></RoommateShell>
  return <>{children}</>
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) {
  const className = tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : tone === 'success' ? 'border-green-200 bg-[#e2f5e9] text-[#168a48]' : 'border-blue-200 bg-blue-50 text-[#203569]'
  return <div role={tone === 'error' ? 'alert' : 'status'} className={'rounded-lg border p-4 text-sm ' + className}>{children}</div>
}
