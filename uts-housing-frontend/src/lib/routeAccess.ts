import type { User } from './types'

function hasRole(user: User, role: string) {
  return user.roles.some(value => value.toUpperCase() === role)
}

export function homeForUser(user: User): string {
  if (hasRole(user, 'ADMIN')) return '/admin'
  if (hasRole(user, 'LAWYER')) return '/lawyer/cases'
  if (hasRole(user, 'LANDLORD')) return '/landlord'
  if (hasRole(user, 'STUDENT')) return '/student'
  return '/dashboard'
}

export function loginDestination(next: string | null, user: User): string {
  const home = homeForUser(user)
  if (!next?.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return home

  let pathname: string
  try {
    const url = new URL(next, 'https://preview.local')
    if (url.origin !== 'https://preview.local') return home
    pathname = url.pathname
  } catch {
    return home
  }

  if (['/', '/login', '/register', '/verify-email', '/forgot-password', '/reset-password', '/accept-invite'].includes(pathname)) return home
  if (/^\/student(?:\/|$)/.test(pathname) && !hasRole(user, 'STUDENT')) return home
  if (/^\/landlord(?:\/|$)/.test(pathname) && !hasRole(user, 'LANDLORD')) return home
  if (/^\/admin(?:\/|$)/.test(pathname) && !hasRole(user, 'ADMIN')) return home
  if (/^\/lawyer(?:\/|$)/.test(pathname) && !hasRole(user, 'LAWYER')) return home
  if (/^\/roommates(?:\/|$)/.test(pathname) && (!hasRole(user, 'STUDENT') || (pathname !== '/roommates/profile' && !user.studentVerified))) return home
  if (pathname === '/reviews/mine' && (!hasRole(user, 'STUDENT') || !user.studentVerified)) return home
  if ((pathname === '/my-listings' || pathname === '/listings/new' || /^\/listings\/[^/]+\/edit$/.test(pathname)) && !hasRole(user, 'STUDENT') && !hasRole(user, 'LANDLORD')) return home
  return next
}
