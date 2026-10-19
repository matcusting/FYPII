// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminCampusesPage } from './AdminCampusesPage'
import { AdminModerationPage } from './AdminModerationPage'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api: apiMock }))

function renderPage(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter>{page}</MemoryRouter></QueryClientProvider>)
}

afterEach(() => { cleanup(); apiMock.mockReset() })

describe('admin moderation', () => {
  it('loads a verification, shows its detail and sends a reason for rejection', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/verifications?')) return { items: [{ id: 'verify-1', status: 'PENDING', student: { name: 'Student A' }, createdAt: '2026-10-19T00:00:00Z' }], pages: 1 }
      if (path === '/admin/verifications/verify-1') return { id: 'verify-1', student: { name: 'Student A', email: 'student@uni.edu.my' }, university: 'University A', verificationMethod: 'MANUAL' }
      return {}
    })
    renderPage(<AdminModerationPage kind="verifications" />)
    expect(await screen.findByText('Student A')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '处理' }))
    expect(await screen.findByText('student@uni.edu.my')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('处理结果'), 'REJECTED')
    await user.type(screen.getByLabelText('处理原因（必填）'), '材料无法核实')
    await user.click(screen.getByRole('button', { name: '保存结果' }))
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/admin/verifications/verify-1', expect.objectContaining({
        method: 'PATCH', body: JSON.stringify({ status: 'REJECTED', reason: '材料无法核实' }),
      }))
    })
  })

  it('suspends an active account with an audit reason', async () => {
    apiMock.mockImplementation(async (path: string) => path.startsWith('/admin/accounts?')
      ? { items: [{ id: 'account-1', name: 'Landlord A', email: 'landlord@example.com', roles: ['LANDLORD'], status: 'ACTIVE' }], pages: 1 }
      : {})
    renderPage(<AdminModerationPage kind="accounts" />)
    expect(await screen.findByText('Landlord A')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '处理' }))
    expect((screen.getByLabelText('处理结果') as HTMLSelectElement).value).toBe('SUSPENDED')
    await user.type(screen.getByLabelText('处理原因（必填）'), '重复违规发布')
    await user.click(screen.getByRole('button', { name: '保存结果' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/admin/accounts/account-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ status: 'SUSPENDED', reason: '重复违规发布' }),
    })))
  })
})

describe('campus settings', () => {
  it('validates domains before creating a campus with coordinates', async () => {
    apiMock.mockImplementation(async (path: string) => path === '/admin/campuses' ? [] : {})
    renderPage(<AdminCampusesPage />)
    expect(await screen.findByText('尚未配置校区。')).toBeTruthy()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('校区名称'), 'North Campus')
    await user.type(screen.getByLabelText('大学名称'), 'University A')
    await user.type(screen.getByLabelText('纬度'), '3.1')
    await user.type(screen.getByLabelText('经度'), '101.6')
    await user.type(screen.getByLabelText('学生验证邮箱域名'), 'bad@domain')
    await user.click(screen.getByRole('button', { name: '创建校区' }))
    expect(screen.getByRole('alert').textContent).toContain('验证域名格式有误')
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
    await user.clear(screen.getByLabelText('学生验证邮箱域名'))
    await user.type(screen.getByLabelText('学生验证邮箱域名'), 'university.edu.my')
    await user.click(screen.getByRole('button', { name: '创建校区' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/admin/campuses', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'North Campus', university: 'University A', latitude: 3.1, longitude: 101.6, domains: ['university.edu.my'], active: true }),
    })))
  })
})
