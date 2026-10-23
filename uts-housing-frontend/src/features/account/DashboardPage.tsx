import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, itemsOf, messageOf } from '../../lib/api'
import { hasRole, useAuth } from '../../lib/auth'
import { LanguageSwitcher, useI18n } from '../../lib/i18n'
import { EmptyNotice, ErrorNotice, LoadingNotice, PageShell, Panel } from './shared'
import { formatDate, labelForStatus } from './format'

interface InquirySummary {
  id: string
  status?: string
  createdAt?: string
  listing?: { id?: string; title?: string }
}

interface OwnedListing { id: string; status?: string }
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

function initials(name: string) {
  return name.trim().split(/\s+/).map(part => part.charAt(0)).join('').slice(0, 2).toUpperCase() || 'UT'
}

function HouseIcon() {
  return <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" fill="#e2e8f0" /><path d="M3 9.5 12 3l9 6.5" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M9 21v-8h6v8" fill="#cbd5e1" /></svg>
}

function PeopleIcon() {
  return <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 21v-2a2 2 0 0 0-1.5-1.9M15 7.2a3 3 0 0 1 0 5.6" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function DashboardPage() {
  const { user, signOut } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [logoutError, setLogoutError] = useState('')
  const isAdmin = hasRole(user, 'ADMIN')
  const isStudent = hasRole(user, 'STUDENT')
  const isLandlord = hasRole(user, 'LANDLORD') && !isStudent && !isAdmin
  const inquiries = useQuery({ queryKey: ['inquiries'], queryFn: () => api<unknown>('/inquiries'), enabled: !!user && !isAdmin })
  const ownedListings = useQuery({ queryKey: ['my-listings'], queryFn: () => api<unknown>('/listings?mine=true&limit=100'), enabled: isLandlord })
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/overview'), enabled: isAdmin })
  const recentInquiries = itemsOf<InquirySummary>(inquiries.data).slice(0, 3)
  const activeListings = itemsOf<OwnedListing>(ownedListings.data).filter(listing => ['PUBLISHED', 'ACTIVE'].includes((listing.status || '').toUpperCase())).length
  const name = user?.name || user?.email?.split('@')[0] || 'Student'

  async function logout() {
    setLogoutError('')
    try { await signOut(); navigate('/login', { replace: true }) }
    catch (error) { setLogoutError(messageOf(error)) }
  }

  if (isStudent) return <div className="min-h-screen bg-[#f8f9fa] px-4 pb-20 pt-8 font-sans text-[#1f2937] sm:px-6">
    <div className="mx-auto max-w-[1000px] overflow-hidden rounded-xl border border-gray-100 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-[#203569] px-6 py-4 text-white sm:px-8">
        <h1 className="text-xl font-semibold tracking-wide">{t('UTS Housing & Roommate Finder')}</h1>
        <div className="flex items-center gap-2">
          <LanguageSwitcher className="max-w-36 rounded-md border border-white/30 bg-[#203569] px-2 py-1 text-xs font-semibold text-white" />
          <Link to="/profile" className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-[#1a2b56]">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-[#203569]">{initials(name)}</span>
            <span className="text-sm font-semibold">{name}</span>
          </Link>
          <span className="mx-2 h-5 w-px bg-white/20" aria-hidden="true" />
          <button type="button" onClick={() => void logout()} className="px-2 text-sm font-bold text-gray-300 transition hover:text-white">{t('Logout')}</button>
        </div>
      </header>
      {logoutError && <p role="alert" className="bg-red-50 px-8 py-3 text-sm text-red-700">{logoutError}</p>}
      <div className="min-h-[500px] p-6 sm:p-10">
        <div className="mb-8">
          <h2 className="mb-2 text-[2.2rem] font-bold leading-tight">{t('Welcome back, {name}!', { name: name.split(/\s+/)[0] })}</h2>
          <p className="text-lg text-gray-500">{t('What are you looking for today?')}</p>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <Link to="/listings" className="group flex min-h-[246px] flex-col items-center justify-center rounded-2xl border border-[#e0e7ff] bg-[#f4f7fb] p-7 text-center transition-all duration-300 hover:shadow-lg sm:p-10">
            <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#203569] transition-transform group-hover:scale-105"><HouseIcon /></span>
            <span className="mb-2 text-2xl font-bold text-[#203569]">{t('Find Housing')}</span>
            <span className="text-sm text-[#3b82f6]">{t('Browse verified rental listings near UTS campus.')}</span>
          </Link>
          <Link to="/roommates" className="group flex min-h-[246px] flex-col items-center justify-center rounded-2xl border border-[#dcfce7] bg-[#f0fdf4] p-7 text-center transition-all duration-300 hover:shadow-lg sm:p-10">
            <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#15803d] transition-transform group-hover:scale-105"><PeopleIcon /></span>
            <span className="mb-2 text-2xl font-bold text-[#15803d]">{t('Find a Roommate')}</span>
            <span className="text-sm text-[#16a34a]">{t('Match with students based on lifestyle habits.')}</span>
          </Link>
        </div>
      </div>
    </div>
    <div className="mx-auto mt-8 max-w-[1000px] rounded-xl border border-gray-100 bg-white p-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)] sm:p-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h3 className="mb-4 text-lg font-bold">{t('Account Status')}</h3>
            <dl className="space-y-3 text-sm text-gray-600">
              <div className="flex justify-between gap-4"><dt>{t('Email')}</dt><dd className="break-all text-right font-semibold text-gray-800">{user?.email}</dd></div>
              <div className="flex justify-between gap-4"><dt>{t('Student verification')}</dt><dd className="font-semibold text-gray-800">{user?.studentVerified ? t('Verified') : labelForStatus(user?.verificationStatus || 'UNVERIFIED')}</dd></div>
            </dl>
            <Link to="/profile" className="mt-5 inline-block text-sm font-bold text-[#203569] hover:underline">{t('Profile Settings →')}</Link>
          </section>
          <section>
            <h3 className="mb-4 text-lg font-bold">{t('Quick Links')}</h3>
            <nav aria-label={t('Quick links')} className="grid grid-cols-2 gap-3 text-sm font-semibold text-[#203569]">
              <Link className="rounded-lg border border-[#e0e7ff] bg-[#f4f7fb] p-3 hover:bg-blue-100" to="/favorites">{t('Saved Listings')}</Link>
              <Link className="rounded-lg border border-[#e0e7ff] bg-[#f4f7fb] p-3 hover:bg-blue-100" to="/requests">{t('Messages & Requests')}</Link>
              <Link className="rounded-lg border border-[#e0e7ff] bg-[#f4f7fb] p-3 hover:bg-blue-100" to="/roommates/profile">{t('Roommate Profile')}</Link>
              <Link className="rounded-lg border border-[#e0e7ff] bg-[#f4f7fb] p-3 hover:bg-blue-100" to="/my-listings">{t('My Listings')}</Link>
              {user?.studentVerified && <Link className="rounded-lg border border-[#e0e7ff] bg-[#f4f7fb] p-3 hover:bg-blue-100" to="/reviews/mine">{t('My Reviews')}</Link>}
            </nav>
          </section>
        </div>
        <section className="mt-9 border-t border-gray-100 pt-7">
          <div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold">{t('Recent Inquiries')}</h3><Link to="/requests" className="text-sm font-bold text-[#203569] hover:underline">{t('View All →')}</Link></div>
          {inquiries.isPending ? <LoadingNotice /> : inquiries.isError ? <ErrorNotice error={inquiries.error} onRetry={() => void inquiries.refetch()} /> : recentInquiries.length ? <ul className="divide-y divide-gray-100">{recentInquiries.map(inquiry => <li key={inquiry.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="font-semibold">{inquiry.listing?.title || t('Property inquiry')}</span><span className="text-gray-500">{labelForStatus(inquiry.status)} · {formatDate(inquiry.createdAt)}</span></li>)}</ul> : <EmptyNotice>{t('No inquiries yet.')}</EmptyNotice>}
        </section>
      </div>
  </div>

  if (isLandlord) return <div className="min-w-0 flex-1 bg-white p-5 text-[#0f172a] sm:p-8 lg:p-10">
    <h1 className="mb-8 border-b border-gray-100 pb-4 text-[1.4rem] font-bold">{t('Overview Dashboard')}</h1>
    <div className="mb-10 grid gap-6 sm:grid-cols-3">
      <Link to="/my-listings" className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-6 transition hover:shadow-md">
        <span className="mb-2 block text-4xl font-bold text-[#1d4ed8]">{ownedListings.isPending ? '…' : ownedListings.isError ? '—' : activeListings}</span>
        <span className="text-sm font-bold text-[#1d4ed8]">{t('Active Listings →')}</span>
      </Link>
      <Link to="/profile" className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] p-6 transition hover:shadow-md">
        <span className="mb-2 block text-4xl font-bold text-[#15803d]">{user?.emailVerified ? '✓' : '—'}</span>
        <span className="text-sm font-bold text-[#15803d]">{t('Account Verification →')}</span>
      </Link>
      <Link to="/requests" className="rounded-xl border border-[#fef08a] bg-[#fefce8] p-6 transition hover:shadow-md">
        <span className="mb-2 block text-4xl font-bold text-[#a16207]">{inquiries.isPending ? '…' : inquiries.isError ? '—' : itemsOf<InquirySummary>(inquiries.data).length}</span>
        <span className="text-sm font-bold text-[#a16207]">{t('Student Inquiries →')}</span>
      </Link>
    </div>
    {(ownedListings.isError || inquiries.isError) && <ErrorNotice error={ownedListings.error || inquiries.error} onRetry={() => { void ownedListings.refetch(); void inquiries.refetch() }} />}
    <h2 className="mb-4 text-[1.1rem] font-bold">{t('Recent Activity')}</h2>
    {inquiries.isPending ? <LoadingNotice /> : recentInquiries.length ? <ul>{recentInquiries.map(inquiry => <li key={inquiry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-b border-gray-100 px-3 py-4 transition hover:bg-gray-50"><div className="flex items-center gap-4"><span className="rounded bg-[#dbeafe] px-3 py-1.5 text-[11px] font-bold text-[#1e40af]">{t('Message')}</span><Link to="/requests" className="text-sm text-gray-600 hover:text-[#203569]">{t('Inquiry about')} <strong className="text-gray-900">{inquiry.listing?.title || t('a property')}</strong></Link></div><span className="text-sm font-medium text-gray-400">{formatDate(inquiry.createdAt)}</span></li>)}</ul> : <EmptyNotice>{t('No recent activity.')}</EmptyNotice>}
    <div className="mt-10 flex flex-wrap gap-3 border-t border-gray-100 pt-6 text-sm font-bold"><Link to="/listings/new" className="rounded-lg bg-[#203569] px-4 py-2.5 text-white hover:bg-[#1a2b56]">{t('+ Add New Listing')}</Link><Link to="/profile" className="rounded-lg border border-gray-300 px-4 py-2.5 text-gray-700 hover:bg-gray-50">{t('Profile Settings')}</Link></div>
  </div>

  const adminQueues = [
    { label: 'Student Verifications', to: '/admin/verifications', count: overviewNumber(overview.data, 'pendingVerifications', 'verificationsPending') },
    { label: 'Listing Reviews', to: '/admin/listings', count: overviewNumber(overview.data, 'pendingListings', 'listingsPending') },
    { label: 'Review Moderation', to: '/admin/reviews', count: overviewNumber(overview.data, 'pendingReviews', 'reviewsPending') },
    { label: 'User Reports', to: '/admin/reports', count: overviewNumber(overview.data, 'openReports', 'pendingReports') },
  ]
  return <PageShell title={t('Hello, {name}', { name })} description={t('Review your account status and pending tasks here.')}>
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title={t('Account Status')}><p className="text-sm text-gray-600">{user?.email}</p><Link to="/profile" className="mt-5 inline-block font-bold text-[#203569] hover:underline">{t('Edit Profile →')}</Link></Panel>
      <Panel title={t('Pending Tasks')}>{overview.isPending ? <LoadingNotice /> : overview.isError ? <ErrorNotice error={overview.error} onRetry={() => void overview.refetch()} /> : <nav className="grid gap-3 sm:grid-cols-2">{adminQueues.map(queue => <Link key={queue.to} to={queue.to} className="rounded-lg border border-gray-200 p-4 hover:bg-[#f4f7fb]"><span className="block font-bold">{t(queue.label)}</span><span className="mt-1 block text-sm text-gray-500">{queue.count === undefined ? t('View queue') : t('{count} pending', { count: queue.count })}</span></Link>)}</nav>}</Panel>
    </div>
  </PageShell>
}
