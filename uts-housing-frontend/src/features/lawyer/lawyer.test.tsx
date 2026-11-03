// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LawyerCasesPage } from './LawyerCasesPage'
import { AdminLawyerCasesPage } from './AdminLawyerCasesPage'
import { homeForUser, loginDestination } from '../../lib/routeAccess'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api: apiMock }))

function renderPage(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter>{page}</MemoryRouter></QueryClientProvider>)
}

afterEach(() => { cleanup(); apiMock.mockReset() })

describe('restricted legal review', () => {
  it('sends a lawyer to the case queue and excludes admin paths', () => {
    const lawyer = { id: 'lawyer', email: 'reviewer@example.test', roles: ['LAWYER'] }
    expect(homeForUser(lawyer)).toBe('/lawyer/cases')
    expect(loginDestination('/admin/landlord-verifications', lawyer)).toBe('/lawyer/cases')
    expect(loginDestination('/lawyer/cases', lawyer)).toBe('/lawyer/cases')
    expect(loginDestination('/lawyer/cases', { ...lawyer, roles: ['STUDENT'] })).toBe('/student')
  })

  it('shows only assigned case evidence and requires written findings for a recommendation', async () => {
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/lawyer/cases?page=1') return { items: [{ id: 'case-1', kind: 'identity', status: 'PENDING', applicantName: 'Synthetic Landlord' }], page: 1, pages: 1 }
      if (path === '/lawyer/cases/identity/case-1') return {
        id: 'case-1', kind: 'identity', status: 'PENDING', evidenceKind: 'COMPANY', applicantName: 'Synthetic Landlord', applicantEmail: 'synthetic@example.test',
        identityUrl: '/api/v1/lawyer/cases/identity/case-1/identity',
        companyUrl: 'https://outside.example/company.pdf',
        representativeUrl: '/api/v1/lawyer/cases/identity/case-1/representative',
      }
      if (options?.method === 'POST') return { decision: 'APPROVE' }
      throw new Error(`Unexpected API request ${path}`)
    })
    renderPage(<LawyerCasesPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Landlord identity · Synthetic Landlord/ }))
    const identity = await screen.findByRole('link', { name: 'MyKad or passport photo' })
    expect(new URL(identity.getAttribute('href')!).pathname).toBe('/api/v1/lawyer/cases/identity/case-1/identity')
    expect(screen.queryByRole('link', { name: 'Company registration document' })).toBeNull()
    await user.type(screen.getByLabelText('Independent source or case reference'), 'synthetic-registry-case')
    await user.click(screen.getByRole('checkbox', { name: 'I independently matched the applicant with the photo ID and account name.' }))
    await user.click(screen.getByRole('checkbox', { name: 'I checked the company registry and representative authorization independently.' }))
    await user.click(screen.getByRole('button', { name: 'Submit recommendation' }))
    expect(screen.getByRole('alert').textContent).toContain('at least 10 characters')
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    await user.type(screen.getByLabelText('Private written finding (required)'), 'The synthetic registry and identity evidence matched.')
    await user.click(screen.getByRole('button', { name: 'Submit recommendation' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/lawyer/cases/identity/case-1/recommendation', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ decision: 'APPROVE', reason: 'The synthetic registry and identity evidence matched.', sourceReference: 'synthetic-registry-case', identityMatched: true, companyRegistryChecked: true }),
    })))
  })

  it('lets an administrator assign a case without exposing an admin account to the lawyer', async () => {
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/admin/lawyer-reviewers') return { items: [{ id: 'lawyer-1', name: 'Synthetic Lawyer', email: 'lawyer@example.test' }] }
      if (path.startsWith('/admin/landlord-verifications?')) return { items: [{ id: 'case-1', kind: 'INDIVIDUAL', status: 'PENDING', landlord: { name: 'Synthetic Landlord', email: 'landlord@example.test' } }], pages: 1 }
      if (path.startsWith('/admin/property-authorizations?')) return { items: [], pages: 1 }
      if (path === '/admin/landlord-verifications/case-1') return { id: 'case-1', status: 'PENDING', lawyerReviewRequired: true, lawyerReview: null }
      if (path === '/admin/lawyer-assignments' && options?.method === 'POST') return { lawyerId: 'lawyer-1' }
      throw new Error(`Unexpected API request ${path}`)
    })
    renderPage(<AdminLawyerCasesPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Synthetic Landlord/ }))
    await screen.findByText('No reviewer assigned yet.')
    await user.selectOptions(screen.getByLabelText('Choose legal reviewer'), 'lawyer-1')
    await user.click(screen.getByRole('button', { name: 'Assign reviewer' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/admin/lawyer-assignments', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ kind: 'identity', id: 'case-1', lawyerId: 'lawyer-1' }),
    })))
  })
})
