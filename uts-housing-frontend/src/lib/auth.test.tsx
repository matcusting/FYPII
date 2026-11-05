// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthGuard, AuthProvider, useAuth } from './auth'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function response(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('protected routes', () => {
  it('refreshes the visible account when another browser tab changes the session', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(200, { data: { id: 'landlord-1', email: 'landlord@example.com', roles: ['LANDLORD'] } }))
      .mockResolvedValue(response(200, { data: { id: 'student-1', email: 'student@example.com', roles: ['STUDENT'] } }))
    vi.stubGlobal('fetch', fetcher)
    function Identity() { const { user } = useAuth(); return <p>{user?.email || 'No account'}</p> }
    render(<MemoryRouter><AuthProvider><Identity /></AuthProvider></MemoryRouter>)
    expect(await screen.findByText('landlord@example.com')).toBeTruthy()
    window.dispatchEvent(new StorageEvent('storage', { key: 'uts-housing-auth-changed', newValue: 'new-session' }))
    await waitFor(() => expect(screen.getByText('student@example.com')).toBeTruthy())
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('redirects unauthenticated visitors to login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, { error: { code: 'UNAUTHORIZED', message: 'Please sign in' } })))
    render(<MemoryRouter initialEntries={['/dashboard']}><AuthProvider><Routes>
      <Route path="/dashboard" element={<AuthGuard><h1>Dashboard</h1></AuthGuard>} />
      <Route path="/login" element={<h1>Please sign in</h1>} />
    </Routes></AuthProvider></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Please sign in' })).toBeTruthy()
  })

  it('accepts an approved student and denies the same account admin access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { data: { id: 'student-1', email: 'student@example.com', roles: ['STUDENT'], verificationStatus: 'APPROVED' } })))
    render(<MemoryRouter initialEntries={['/roommates']}><AuthProvider><Routes>
      <Route path="/roommates" element={<AuthGuard roles={['STUDENT']} verifiedStudent><><h1>Roommate matches</h1><Link to="/admin">Open admin dashboard</Link></></AuthGuard>} />
      <Route path="/admin" element={<AuthGuard roles={['ADMIN']}><h1>Admin dashboard</h1></AuthGuard>} />
    </Routes></AuthProvider></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Roommate matches' })).toBeTruthy()
    await userEvent.click(screen.getByRole('link', { name: 'Open admin dashboard' }))
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to Your Dashboard' }).getAttribute('href')).toBe('/student')
    expect(screen.queryByRole('heading', { name: 'Admin dashboard' })).toBeNull()
  })

  it('honors the server decision when a historic approval has expired', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { data: {
      id: 'expired-student', email: 'expired@student.uts.edu.my', roles: ['STUDENT'],
      studentVerified: false, verificationStatus: 'APPROVED',
    } })))
    render(<MemoryRouter initialEntries={['/roommates']}><AuthProvider><Routes>
      <Route path="/roommates" element={<AuthGuard roles={['STUDENT']} verifiedStudent><h1>Roommate matches</h1></AuthGuard>} />
    </Routes></AuthProvider></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Student verification required' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Roommate matches' })).toBeNull()
  })
})
