// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminDeletionRequestsPage } from './AdminDeletionRequestsPage'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', async original => ({ ...(await original<typeof import('../../lib/api')>()), api: apiMock }))

afterEach(() => { cleanup(); apiMock.mockReset() })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><AdminDeletionRequestsPage /></MemoryRouter></QueryClientProvider>)
}

describe('account deletion review', () => {
  it('requires explicit acknowledgment before approving and sends a reason', async () => {
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') return { id: 'request-1', status: 'APPROVED' }
      if (path.startsWith('/admin/deletion-requests?')) return {
        items: [{ id: 'request-1', status: 'PENDING', requestedAt: '2026-10-27T00:00:00Z', user: { name: 'Example Student', email: 'example@student.uts.edu.my', roles: ['STUDENT'] } }],
        pages: 1,
      }
      throw new Error(`Unexpected API request: ${path}`)
    })
    renderPage()
    const user = userEvent.setup()
    expect(await screen.findByText('Example Student')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.selectOptions(screen.getByLabelText('Decision'), 'APPROVED')
    await user.type(screen.getByLabelText('Reason (required)'), 'Requested by account holder')
    await user.click(screen.getByRole('button', { name: 'Save decision' }))
    expect(screen.getByRole('alert').textContent).toContain('Confirm that you understand')
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
    await user.click(screen.getByRole('checkbox', { name: /I understand this will deactivate/ }))
    await user.click(screen.getByRole('button', { name: 'Save decision' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/admin/deletion-requests/request-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ status: 'APPROVED', reason: 'Requested by account holder' }),
    })))
  })

  it('rejects a request with a reason without requiring approval acknowledgment', async () => {
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') return { id: 'request-2', status: 'REJECTED' }
      if (path.startsWith('/admin/deletion-requests?')) return {
        items: [{ id: 'request-2', status: 'PENDING', user: { name: 'Example Landlord', email: 'landlord@example.com', roles: ['LANDLORD'] } }], pages: 1,
      }
      return {}
    })
    renderPage()
    const user = userEvent.setup()
    expect(await screen.findByText('Example Landlord')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.type(screen.getByLabelText('Reason (required)'), 'Please resolve your open inquiry first')
    await user.click(screen.getByRole('button', { name: 'Save decision' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/admin/deletion-requests/request-2', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ status: 'REJECTED', reason: 'Please resolve your open inquiry first' }),
    })))
  })
})
