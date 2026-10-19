// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LoginPage, RegisterPage } from './AuthPages'

const { apiMock, signInMock } = vi.hoisted(() => ({ apiMock: vi.fn(), signInMock: vi.fn() }))
vi.mock('../../lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api: apiMock }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: null, signIn: signInMock }) }))

afterEach(() => { cleanup(); apiMock.mockReset(); signInMock.mockReset() })

describe('account forms', () => {
  it('blocks invalid registration and submits only validated, accepted details', async () => {
    apiMock.mockResolvedValue({})
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('姓名'), 'Student A')
    await user.type(screen.getByLabelText('邮箱'), 'student@example.com')
    await user.type(screen.getByLabelText('密码', { exact: true }), 'GoodPass123')
    await user.type(screen.getByLabelText('确认密码'), 'WrongPass123')
    await user.click(screen.getByRole('button', { name: '创建账户' }))
    expect(await screen.findByText('两次输入的密码不一致。')).toBeTruthy()
    expect(screen.getByText('请先阅读并同意使用条款与隐私说明。')).toBeTruthy()
    expect(apiMock).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('确认密码'))
    await user.type(screen.getByLabelText('确认密码'), 'GoodPass123')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: '创建账户' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/auth/register', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Student A', email: 'student@example.com', password: 'GoodPass123', role: 'STUDENT', acceptTerms: true }),
    })))
    expect(await screen.findByText(/注册请求已完成/)).toBeTruthy()
  })

  it('rejects malformed login details and ignores an external return URL', async () => {
    signInMock.mockResolvedValue({})
    render(<MemoryRouter initialEntries={['/login?next=%2F%2Fevil.example']}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/dashboard" element={<p>个人首页已打开</p>} /></Routes></MemoryRouter>)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('邮箱'), 'bad-email')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('请输入有效的邮箱地址。')).toBeTruthy()
    expect(signInMock).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('邮箱'))
    await user.type(screen.getByLabelText('邮箱'), 'student@example.com')
    await user.type(screen.getByLabelText('密码'), 'GoodPass123')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('个人首页已打开')).toBeTruthy()
    expect(signInMock).toHaveBeenCalledWith('student@example.com', 'GoodPass123')
  })
})
