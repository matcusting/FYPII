import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { api, ApiError, messageOf } from './api'
import { homeForUser } from './routeAccess'
import { useI18n } from './i18n'
import type { User } from './types'

interface AuthContextValue {
  user: User | null
  loading: boolean
  error: string | null
  refresh: () => Promise<User | null>
  signIn: (email: string, password: string, mfaCode?: string) => Promise<User>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const authSyncKey = 'uts-housing-auth-changed'
export const authChangedEvent = 'uts-housing-account-changed'

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
  return { ...raw, roles, studentVerified: typeof raw.studentVerified === 'boolean' ? raw.studentVerified : status?.toUpperCase() === 'APPROVED' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const userId = useRef<string | null>(null)
  const applyUser = useCallback((next: User | null) => {
    if (userId.current !== next?.id) {
      userId.current = next?.id || null
      window.dispatchEvent(new Event(authChangedEvent))
    }
    setUser(next)
  }, [])
  const broadcastAuthChange = useCallback(() => {
    try { window.localStorage.setItem(authSyncKey, `${Date.now()}-${Math.random()}`) }
    catch { /* The focus check still updates tabs when storage is unavailable. */ }
  }, [])
  const refresh = useCallback(async () => {
    try {
      const current = normalizeUser(await api<User>('/auth/me'))
      applyUser(current)
      setError(null)
      return current
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        applyUser(null)
        setError(null)
      } else setError(messageOf(failure))
      return null
    } finally {
      setLoading(false)
    }
  }, [applyUser])
  useEffect(() => {
    let active = true
    api<User>('/auth/me').then(current => {
      if (active) { applyUser(normalizeUser(current)); setError(null) }
    }).catch(failure => {
      if (!active) return
      if (failure instanceof ApiError && failure.status === 401) { applyUser(null); setError(null) }
      else setError(messageOf(failure))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [applyUser])
  useEffect(() => {
    const onFocus = () => { void refresh() }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    const onStorage = (event: StorageEvent) => { if (event.key === authSyncKey) void refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('storage', onStorage)
    }
  }, [refresh])
  const signIn = useCallback(async (email: string, password: string, mfaCode?: string) => {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, ...(mfaCode ? { mfaCode } : {}) }) })
    const current = await refresh()
    if (!current) throw new Error('You signed in, but your account details could not be loaded.')
    broadcastAuthChange()
    return current
  }, [refresh, broadcastAuthChange])
  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' })
    applyUser(null)
    broadcastAuthChange()
  }, [applyUser, broadcastAuthChange])
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
  const { t } = useI18n()
  const location = useLocation()
  if (loading) return <div className="container py-16" role="status">{t('Checking your sign-in status…')}</div>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (user.mfaSetupRequired && hasRole(user, 'ADMIN', 'LAWYER')) return <Navigate to="/mfa-setup" replace />
  if (roles && !hasRole(user, ...roles)) return <div className="container py-16"><h1>{t('Access denied')}</h1><p>{t('This account does not have permission to view this page. Signed in as {email}.', { email: user.email })}</p><Link to={homeForUser(user)} className="mt-4 inline-block font-semibold text-blue-800 underline">{t('Go to Your Dashboard')}</Link></div>
  if (verifiedStudent && !user.studentVerified) return <div className="container py-16"><h1>{t('Student verification required')}</h1><p>{t('Verify your student status before using this feature.')}</p></div>
  return <>{children}</>
}
