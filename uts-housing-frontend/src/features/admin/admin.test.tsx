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
  it('shows both student documents only after opening a verification detail', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/verifications?')) return { items: [{ id: 'verify-docs', status: 'PENDING', student: { name: 'Student A' } }], pages: 1 }
      if (path === '/admin/verifications/verify-docs') return {
        id: 'verify-docs', status: 'PENDING', verificationMethod: 'DOCUMENTS', university: 'University A',
        student: { name: 'Student A', email: 'student@student.uts.edu.my', emailVerified: true },
        studentIdUrl: '/api/v1/admin/verifications/verify-docs/student-id',
        offerLetterUrl: '/api/v1/admin/verifications/verify-docs/offer-letter',
      }
      throw new Error(`Unexpected API request: ${path}`)
    })
    renderPage(<AdminModerationPage kind="verifications" />)
    expect(await screen.findByText('Student A')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Download student ID (review only)' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    const studentId = await screen.findByRole('link', { name: 'Download student ID (review only)' })
    const offerLetter = screen.getByRole('link', { name: 'Download offer letter (review only)' })
    expect(new URL(studentId.getAttribute('href')!).pathname).toBe('/api/v1/admin/verifications/verify-docs/student-id')
    expect(new URL(offerLetter.getAttribute('href')!).pathname).toBe('/api/v1/admin/verifications/verify-docs/offer-letter')
    expect(screen.getByText('student@student.uts.edu.my')).toBeTruthy()
    expect(screen.getByText('Verified')).toBeTruthy()
  })

  it('rejects an external document link and prevents approval without both private files', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/verifications?')) return { items: [{ id: 'verify-docs', status: 'PENDING', student: { name: 'Student B' } }] }
      if (path === '/admin/verifications/verify-docs') return {
        id: 'verify-docs', verificationMethod: 'DOCUMENTS',
        studentIdUrl: '/api/v1/admin/verifications/verify-docs/student-id',
        offerLetterUrl: 'https://outside.example/offer-letter',
      }
      throw new Error(`Unexpected API request: ${path}`)
    })
    renderPage(<AdminModerationPage kind="verifications" />)
    await screen.findByText('Student B')
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    await screen.findByRole('link', { name: 'Download student ID (review only)' })
    expect(screen.queryByRole('link', { name: 'Download offer letter (review only)' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save decision' }))
    expect(screen.getByRole('alert').textContent).toContain('Both student documents must be available before approval.')
    expect(apiMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })

  it('loads a verification, shows its detail and sends a reason for rejection', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/verifications?')) return { items: [{ id: 'verify-1', status: 'PENDING', student: { name: 'Student A' }, createdAt: '2026-10-19T00:00:00Z' }], pages: 1 }
      if (path === '/admin/verifications/verify-1') return { id: 'verify-1', student: { name: 'Student A', email: 'student@uni.edu.my' }, university: 'University A', verificationMethod: 'MANUAL' }
      return {}
    })
    renderPage(<AdminModerationPage kind="verifications" />)
    expect(await screen.findByText('Student A')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(await screen.findByText('student@uni.edu.my')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Decision'), 'REJECTED')
    await user.type(screen.getByLabelText('Reason (required)'), 'Documents could not be verified')
    await user.click(screen.getByRole('button', { name: 'Save decision' }))
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/admin/verifications/verify-1', expect.objectContaining({
        method: 'PATCH', body: JSON.stringify({ status: 'REJECTED', reason: 'Documents could not be verified' }),
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
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect((screen.getByLabelText('Decision') as HTMLSelectElement).value).toBe('SUSPENDED')
    await user.type(screen.getByLabelText('Reason (required)'), 'Repeated policy violations')
    await user.click(screen.getByRole('button', { name: 'Save decision' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/admin/accounts/account-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ status: 'SUSPENDED', reason: 'Repeated policy violations' }),
    })))
  })
})

describe('campus settings', () => {
  it('validates domains before creating a campus with coordinates', async () => {
    apiMock.mockImplementation(async (path: string) => path === '/admin/campuses' ? [] : {})
    renderPage(<AdminCampusesPage />)
    expect(await screen.findByText('No campuses have been configured.')).toBeTruthy()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Campus name'), 'North Campus')
    await user.type(screen.getByLabelText('University name'), 'University A')
    await user.type(screen.getByLabelText('Latitude'), '3.1')
    await user.type(screen.getByLabelText('Longitude'), '101.6')
    await user.type(screen.getByLabelText('Student verification email domains'), 'bad@domain')
    await user.click(screen.getByRole('button', { name: 'Create campus' }))
    expect(screen.getByRole('alert').textContent).toContain('Invalid verification domain')
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
    await user.clear(screen.getByLabelText('Student verification email domains'))
    await user.type(screen.getByLabelText('Student verification email domains'), 'university.edu.my')
    await user.click(screen.getByRole('button', { name: 'Create campus' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/admin/campuses', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'North Campus', university: 'University A', latitude: 3.1, longitude: 101.6, domains: ['university.edu.my'], active: true }),
    })))
  })
})
