import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { api, ApiError, messageOf } from './api'
import { homeForUser } from './routeAccess'
import type { User } from './types'

interface AuthContextValue {
  user: User | null
  loading: boolean
  error: string | null
  refresh: () => Promise<User | null>
  signIn: (email: string, password: string) => Promise<User>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function normalizeUser(raw: User): User {
  const source = raw as User & { studentVerification?: { status?: string } }
  const status = raw.verificationStatus || source.studentVerification?.status
  const roles = Array.isArray(raw.roles) ? raw.roles.map(value => {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      const item = value as { role?: string; name?: string }
      return item.role || item.name || ''
    }
    return ''
  }).filter(Boolean) : []
  return { ...raw, roles, studentVerified: raw.studentVerified === true || status?.toUpperCase() === 'APPROVED' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      const current = normalizeUser(await api<User>('/auth/me'))
      setUser(current)
      setError(null)
      return current
    } catch (failure) {
      setUser(null)
      if (!(failure instanceof ApiError && failure.status === 401)) setError(messageOf(failure))
      return null
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    let active = true
    api<User>('/auth/me').then(current => {
      if (active) { setUser(normalizeUser(current)); setError(null) }
    }).catch(failure => {
      if (active && !(failure instanceof ApiError && failure.status === 401)) setError(messageOf(failure))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const signIn = useCallback(async (email: string, password: string) => {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    const current = await refresh()
    if (!current) throw new Error('You signed in, but your account details could not be loaded.')
    return current
  }, [refresh])
  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' })
    setUser(null)
  }, [])
  const value = useMemo(() => ({ user, loading, error, refresh, signIn, signOut }), [user, loading, error, refresh, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be inside AuthProvider')
  return context
}

export function hasRole(user: User | null, ...roles: string[]) {
  return !!user && roles.some(role => user.roles.some(value => value.toLowerCase() === role.toLowerCase()))
}

export function AuthGuard({ children, roles, verifiedStudent = false }: { children: ReactNode; roles?: string[]; verifiedStudent?: boolean }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="container py-16" role="status">Checking your sign-in status…</div>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (roles && !hasRole(user, ...roles)) return <div className="container py-16"><h1>Access denied</h1><p>This account does not have permission to view this page. Signed in as {user.email}.</p><Link to={homeForUser(user)} className="mt-4 inline-block font-semibold text-blue-800 underline">Go to Your Dashboard</Link></div>
  if (verifiedStudent && !user.studentVerified) return <div className="container py-16"><h1>Student verification required</h1><p>Verify your student status before using this feature.</p></div>
  return <>{children}</>
}
