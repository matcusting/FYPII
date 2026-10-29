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
  it('requires a reviewer to compare the student card ID with the school email before approval', async () => {
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') return { id: 'verify-match', status: 'APPROVED' }
      if (path.startsWith('/admin/verifications?')) return { items: [{ id: 'verify-match', status: 'PENDING', student: { name: 'Example Student' } }], pages: 1 }
      if (path === '/admin/verifications/verify-match') return {
        id: 'verify-match', status: 'PENDING', verificationMethod: 'DOCUMENTS', student: { name: 'Example Student', email: 'demo123@student.uts.edu.my' },
        studentIdUrl: '/api/v1/admin/verifications/verify-match/student-id',
        offerLetterUrl: '/api/v1/admin/verifications/verify-match/offer-letter',
      }
      return {}
    })
    renderPage(<AdminModerationPage kind="verifications" />)
    const user = userEvent.setup()
    await screen.findByText('Example Student')
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await screen.findByRole('link', { name: 'Download student ID (review only)' })
    await user.click(screen.getByRole('button', { name: 'Save decision' }))
    expect(screen.getByRole('alert').textContent).toContain('Student ID on the card matches')
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
    await user.click(screen.getByRole('checkbox', { name: /I compared the Student ID/ }))
    await user.click(screen.getByRole('button', { name: 'Save decision' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/admin/verifications/verify-match', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ status: 'APPROVED', reason: '', studentIdMatchesEmail: true }),
    })))
  })

  it('records an authorized university check only with a source reference', async () => {
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') return { id: 'verify-official', status: 'APPROVED' }
      if (path.startsWith('/admin/verifications?')) return { items: [{ id: 'verify-official', status: 'PENDING', student: { name: 'Example Student' } }], pages: 1 }
      if (path === '/admin/verifications/verify-official') return {
        id: 'verify-official', status: 'PENDING', verificationMethod: 'DOCUMENTS', student: { name: 'Example Student', email: 'example@student.uts.edu.my' },
        studentIdUrl: '/api/v1/admin/verifications/verify-official/student-id', offerLetterUrl: '/api/v1/admin/verifications/verify-official/offer-letter',
      }
      return {}
    })
    renderPage(<AdminModerationPage kind="verifications" />)
    const user = userEvent.setup()
    await screen.findByText('Example Student')
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await screen.findByRole('link', { name: 'Download student ID (review only)' })
    await user.click(screen.getByRole('checkbox', { name: /I compared the Student ID/ }))
    await user.selectOptions(screen.getByLabelText('Official enrollment check'), 'ACTIVE')
    await user.click(screen.getByRole('button', { name: 'Save decision' }))
    expect(screen.getByRole('alert').textContent).toContain('official source reference')
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
    await user.type(screen.getByLabelText('Official source reference'), 'synthetic-case-1')
    await user.click(screen.getByRole('button', { name: 'Save decision' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/admin/verifications/verify-official', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ status: 'APPROVED', reason: '', studentIdMatchesEmail: true, enrollmentCheckStatus: 'ACTIVE', enrollmentCheckReference: 'synthetic-case-1' }),
    })))
  })

  it('shows all required company identity evidence in the landlord review queue', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/landlord-verifications?')) return { items: [{ id: 'identity-1', kind: 'COMPANY', status: 'PENDING', landlord: { name: 'Example Company' } }] }
      if (path === '/admin/landlord-verifications/identity-1') return {
        id: 'identity-1', kind: 'COMPANY', status: 'PENDING', landlord: { name: 'Example Company', email: 'example@demo.local', emailVerified: true, phone: '+60123456789' },
        identityUrl: '/api/v1/admin/landlord-verifications/identity-1/identity',
        companyUrl: '/api/v1/admin/landlord-verifications/identity-1/company',
        representativeUrl: '/api/v1/admin/landlord-verifications/identity-1/representative',
      }
      return {}
    })
    renderPage(<AdminModerationPage kind="landlord-verifications" />)
    expect(await screen.findByText('Example Company')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open private document (review only)' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(await screen.findAllByRole('link', { name: 'Open private document (review only)' })).toHaveLength(3)
  })

  it('refuses property approval when an evidence link leaves the private admin route', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/property-authorizations?')) return { items: [{ id: 'authority-1', kind: 'SUBLETTING', status: 'PENDING', listing: { title: 'Demo room' } }] }
      if (path === '/admin/property-authorizations/authority-1') return {
        id: 'authority-1', kind: 'SUBLETTING', status: 'PENDING', addressSnapshot: '12 Jalan Demo, Sibu', listing: { title: 'Demo room' },
        proofUrl: '/api/v1/admin/property-authorizations/authority-1/proof',
        supportingUrl: 'https://external.example/consent.pdf',
      }
      return {}
    })
    renderPage(<AdminModerationPage kind="property-authorizations" />)
    expect(await screen.findByText('Demo room')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(await screen.findByText('Document unavailable')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Save decision' }))
    expect(screen.getByRole('alert').textContent).toContain('Required property authorization documents must be available before approval.')
    expect(apiMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })

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
