import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { messageOf } from '../lib/api'
import { hasRole, useAuth } from '../lib/auth'

const authScreens = new Set(['/', '/login', '/register', '/verify-email', '/forgot-password', '/reset-password'])
const studentPaths = /^\/(?:student(?:\/|$)|dashboard$|profile$|favorites$|requests$|reviews\/mine$|roommates(?:\/|$)|listings(?:\/|$)|my-listings$)/
const landlordPaths = /^\/(?:landlord(?:\/|$)|dashboard$|profile$|requests$|my-listings$|listings\/new$|listings\/[^/]+\/edit$)/

function PageContent({ className = '' }: { className?: string }) {
  return <main id="main" className={className}>
    <Suspense fallback={<div className="mx-auto max-w-[1000px] px-4 py-16" role="status">Loading page…</div>}><Outlet /></Suspense>
  </main>
}

export default function SiteLayout() {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState('')
  const pathname = location.pathname
  const isLandlord = hasRole(user, 'LANDLORD') && landlordPaths.test(pathname)
  const isStudent = hasRole(user, 'STUDENT') && !isLandlord && studentPaths.test(pathname)
  const isStudentDashboard = isStudent && (pathname === '/student' || pathname === '/dashboard')

  async function logout() {
    try {
      setError('')
      await signOut()
      navigate('/', { replace: true })
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  if (authScreens.has(pathname)) {
    return <div className="min-h-screen bg-[#f8f9fa]">
      <a className="skip-link" href="#main">Skip to main content</a>
      <PageContent />
    </div>
  }

  if (isLandlord) {
    const items = [
      { to: '/landlord', label: 'Dashboard', icon: '📊', active: pathname === '/landlord' || pathname === '/dashboard' },
      { to: '/landlord/messages', label: 'Messages', icon: '💬', active: pathname === '/landlord/messages' || pathname === '/requests' },
      { to: '/landlord/add', label: 'Add New Listing', icon: '✚', active: pathname === '/landlord/add' || pathname === '/listings/new' },
      { to: '/landlord/manage', label: 'Manage Listings', icon: '🏠', active: pathname === '/landlord/manage' || pathname === '/my-listings' || pathname.endsWith('/edit') },
      { to: '/landlord/reviews', label: 'Student Reviews', icon: '⭐', active: pathname === '/landlord/reviews' },
    ]
    return <div className="min-h-screen bg-[#f3f4f6] p-3 font-sans sm:p-8">
      <a className="skip-link" href="#main">Skip to main content</a>
      <div className="mx-auto flex min-h-[680px] max-w-6xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.05)]">
        <header className="flex flex-wrap items-center justify-between gap-3 bg-[#0f172a] px-5 py-5 sm:px-8">
          <Link to="/landlord" className="text-lg font-bold tracking-wide text-white sm:text-xl">UTS Housing Provider Portal</Link>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <span className="rounded bg-[#22c55e] px-3 py-1 text-[11px] font-bold text-white">Landlord Account</span>
            <Link to="/profile" className="text-sm font-bold text-white hover:underline">{user?.name || user?.email || 'Profile'}</Link>
            <button type="button" onClick={() => void logout()} className="text-sm font-bold text-gray-400 transition hover:text-white">Logout</button>
          </div>
        </header>
        {error && <p role="alert" className="notice-error m-4">{error}</p>}
        <div className="flex flex-1 flex-col sm:flex-row">
          <nav aria-label="Landlord portal" className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 bg-[#f8f9fa] p-3 sm:w-[260px] sm:flex-col sm:space-y-2 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-6">
            {items.map(item => <Link key={item.to} to={item.to} aria-current={item.active ? 'page' : undefined} className={'flex shrink-0 items-center gap-3 rounded-lg px-4 py-3 text-sm font-bold transition-colors sm:text-base ' + (item.active ? 'bg-[#e0e7ff] text-[#1d4ed8]' : 'text-gray-600 hover:bg-gray-100')}>
              <span className="text-lg" aria-hidden="true">{item.icon}</span>{item.label}
            </Link>)}
          </nav>
          <PageContent className="min-w-0 flex-1 bg-white" />
        </div>
      </div>
    </div>
  }

  if (isStudent) {
    return <div className="min-h-screen bg-[#f8f9fa] font-sans">
      <a className="skip-link" href="#main">Skip to main content</a>
      {!isStudentDashboard && <header className="sticky top-0 z-50 mb-6 w-full border-b border-gray-200 bg-white/90 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1000px] items-center justify-between gap-3 px-4 xl:px-0">
          <Link to="/student" className="group flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#203569] text-sm font-bold text-white shadow-sm transition-colors group-hover:bg-[#1a2b56]">UTS</span>
            <span className="truncate text-[1.1rem] font-bold text-[#1f2937] transition-colors group-hover:text-[#203569]">Housing &amp; Roommate Finder</span>
          </Link>
          <button type="button" className="rounded-md px-2 py-1 text-xl text-[#203569] md:hidden" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? '✕' : '☰'}</button>
          <nav aria-label="Student navigation" className={'items-center gap-6 text-sm font-bold max-md:absolute max-md:left-0 max-md:right-0 max-md:top-16 max-md:border-b max-md:border-gray-200 max-md:bg-white max-md:p-4 max-md:shadow-md md:flex ' + (menuOpen ? 'flex flex-col' : 'hidden')}>
            <Link to="/student" onClick={() => setMenuOpen(false)} className="text-gray-500 transition-colors hover:text-[#203569]">Dashboard</Link>
            <Link to="/student/messages" onClick={() => setMenuOpen(false)} className="flex items-center gap-1.5 text-gray-500 transition-colors hover:text-[#203569]"><span className="text-lg" aria-hidden="true">💬</span> Messages</Link>
            <Link to="/student/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-1.5 text-gray-500 transition-colors hover:text-[#203569]"><span className="text-lg" aria-hidden="true">👤</span> Profile</Link>
            <span className="hidden h-5 w-px bg-gray-300 md:block" />
            <button type="button" onClick={() => { setMenuOpen(false); void logout() }} className="text-gray-400 transition-colors hover:text-red-600">Logout</button>
          </nav>
        </div>
      </header>}
      {error && <p role="alert" className="notice-error mx-auto max-w-[1000px]">{error}</p>}
      <PageContent />
    </div>
  }

  const links = [
    { to: '/welcome', label: 'Home' },
    { to: '/listings', label: 'Find Housing' },
    ...(user ? [{ to: '/dashboard', label: 'Dashboard' }, { to: '/favorites', label: 'Favorites' }, { to: '/profile', label: 'Profile' }] : []),
    ...(hasRole(user, 'STUDENT') ? [{ to: '/roommates', label: 'Find a Roommate' }, { to: '/requests', label: 'Messages' }] : []),
    ...(hasRole(user, 'STUDENT', 'LANDLORD') ? [{ to: '/my-listings', label: 'My Listings' }] : []),
    ...(hasRole(user, 'ADMIN') ? [{ to: '/admin', label: 'Admin' }] : []),
  ]
  return <div className="site-shell">
    <a className="skip-link" href="#main">Skip to main content</a>
    <header className="site-header">
      <div className="container nav-inner">
        <Link className="brand" to="/welcome" onClick={() => setMenuOpen(false)} aria-label="UTS Housing home">UTS <span>Housing</span></Link>
        <button className="menu-button" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="site-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? '✕' : '☰'}</button>
        <nav id="site-nav" aria-label="Main navigation" className={'nav-links ' + (menuOpen ? 'is-open' : '')}>
          {links.map(link => <NavLink key={link.to} to={link.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => isActive ? 'nav-link is-active' : 'nav-link'}>{link.label}</NavLink>)}
          {user ? <button type="button" className="nav-link nav-action" onClick={() => { setMenuOpen(false); void logout() }}>Log out</button> : <>
            <NavLink to="/login" className="nav-link" onClick={() => setMenuOpen(false)}>Log in</NavLink>
            <Link to="/register" className="button button-small" onClick={() => setMenuOpen(false)}>Sign up</Link>
          </>}
        </nav>
      </div>
      {error && <div role="alert" className="container notice-error">{error}</div>}
    </header>
    <PageContent />
    <footer className="site-footer"><div className="container footer-inner"><span>UTS Housing &amp; Roommate Finder</span><nav aria-label="Footer"><Link to="/help">Help</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav></div></footer>
  </div>
}
