// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthGuard, AuthProvider } from './auth'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function response(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('protected routes', () => {
  it('redirects unauthenticated visitors to login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, { error: { code: 'UNAUTHORIZED', message: 'Please sign in' } })))
    render(<MemoryRouter initialEntries={['/dashboard']}><AuthProvider><Routes>
      <Route path="/dashboard" element={<AuthGuard><h1>个人中心</h1></AuthGuard>} />
      <Route path="/login" element={<h1>请登录</h1>} />
    </Routes></AuthProvider></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '请登录' })).toBeTruthy()
  })

  it('accepts an approved student and denies the same account admin access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { data: { id: 'student-1', email: 'student@example.com', roles: ['STUDENT'], verificationStatus: 'APPROVED' } })))
    render(<MemoryRouter initialEntries={['/roommates']}><AuthProvider><Routes>
      <Route path="/roommates" element={<AuthGuard roles={['STUDENT']} verifiedStudent><><h1>室友匹配</h1><Link to="/admin">打开管理后台</Link></></AuthGuard>} />
      <Route path="/admin" element={<AuthGuard roles={['ADMIN']}><h1>管理后台</h1></AuthGuard>} />
    </Routes></AuthProvider></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '室友匹配' })).toBeTruthy()
    await userEvent.click(screen.getByRole('link', { name: '打开管理后台' }))
    expect(await screen.findByRole('heading', { name: '无权访问' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '管理后台' })).toBeNull()
  })
})
