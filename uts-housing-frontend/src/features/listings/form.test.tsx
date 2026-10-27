// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ListingFormPage } from './form'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../../lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api: apiMock }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: { id: 'landlord-1', email: 'landlord@example.com', roles: ['LANDLORD'], emailVerified: true } }), hasRole: (user: { roles: string[] } | null, ...roles: string[]) => !!user && roles.some(role => user.roles.includes(role)) }))

afterEach(() => { cleanup(); apiMock.mockReset() })

describe('property authorization in listing editor', () => {
  it('uploads authority proof without submitting or saving the listing form', async () => {
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/listings/listing-1') return { id: 'listing-1', title: 'Room near campus', address: '12 Jalan Campus, Sibu', status: 'DRAFT', photos: [], amenityIds: [] }
      if (path === '/campuses' || path === '/amenities') return { items: [] }
      if (path === '/landlord-verifications/me') return { status: 'APPROVED', latest: null }
      if (path === '/landlord-verifications/listings/listing-1' && init?.method === 'POST') return { id: 'authority-1', status: 'PENDING' }
      if (path === '/landlord-verifications/listings/listing-1') return { status: 'UNVERIFIED', latest: null }
      throw new Error(`Unexpected API call: ${path}`)
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/listings/listing-1/edit']}><Routes><Route path="/listings/:id/edit" element={<ListingFormPage />} /></Routes></MemoryRouter></QueryClientProvider>)
    const user = userEvent.setup()
    const upload = await screen.findByLabelText(/Ownership evidence/)
    await user.upload(upload, new File(['%PDF-1.4\nfictional proof'], 'ownership.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Submit Property Documents' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/landlord-verifications/listings/listing-1', expect.objectContaining({ method: 'POST', body: expect.any(FormData) })))
    expect(apiMock).not.toHaveBeenCalledWith('/listings/listing-1', expect.objectContaining({ method: 'PATCH' }))
    expect(apiMock).not.toHaveBeenCalledWith('/listings/listing-1/submit', expect.anything())
  })

  it('warns before replacing approved property evidence and keeps the listing out of direct publication', async () => {
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/listings/listing-1') return { id: 'listing-1', title: 'Room near campus', address: '12 Jalan Campus, Sibu', status: 'PUBLISHED', photos: [], amenityIds: [] }
      if (path === '/campuses' || path === '/amenities') return { items: [] }
      if (path === '/landlord-verifications/me') return { status: 'APPROVED', latest: null }
      if (path === '/landlord-verifications/listings/listing-1' && init?.method === 'POST') return { id: 'authority-2', status: 'PENDING' }
      if (path === '/landlord-verifications/listings/listing-1') return { status: 'APPROVED', latest: null }
      throw new Error(`Unexpected API call: ${path}`)
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/listings/listing-1/edit']}><Routes><Route path="/listings/:id/edit" element={<ListingFormPage />} /></Routes></MemoryRouter></QueryClientProvider>)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Replace Property Documents' }))
    expect(screen.getByText(/withdraws current authorization and pauses a published listing/)).toBeTruthy()
    await user.upload(screen.getByLabelText(/Ownership evidence/), new File(['%PDF-1.4\nfictional proof'], 'replacement.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Submit Property Documents' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/landlord-verifications/listings/listing-1', expect.objectContaining({ method: 'POST' })))
    expect(apiMock).not.toHaveBeenCalledWith('/listings/listing-1/submit', expect.anything())
  })
})
