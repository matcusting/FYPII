// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ListingsPage } from './search'
import { ListingDetailPage } from './detail'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api: apiMock }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: null }) }))

afterEach(() => { cleanup(); apiMock.mockReset() })

describe('listing search', () => {
  it('sends filters to the API and displays approved server results', async () => {
    apiMock.mockImplementation(async (path: string) => path === '/campuses' ? [{ id: 'campus-1', name: 'Main Campus' }] : { items: [{ id: 'listing-1', title: 'Verified listing', rent: '650.00', currency: 'MYR', status: 'PUBLISHED', distanceKm: 2.3, campusName: 'Main Campus', lastConfirmedAt: new Date().toISOString(), availabilityStale: false }], total: 1, page: 1, pages: 1 })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><ListingsPage /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText('Verified listing')).toBeTruthy()
    expect(screen.getByText('2.3 km to Main Campus')).toBeTruthy()
    expect(screen.getByText(/Owner confirmed availability on/)).toBeTruthy()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Campus'), 'campus-1')
    await user.type(screen.getByLabelText('Maximum rent amount (RM)'), '700')
    await user.type(screen.getByRole('spinbutton', { name: /Maximum distance to campus/ }), '5')
    await user.click(screen.getByLabelText('Only show homes confirmed by the owner in the last 30 days'))
    await user.click(screen.getByText('More Filters'))
    await user.selectOptions(screen.getByLabelText('Sort By'), 'distance')
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('campusId=campus-1')))
    expect(apiMock.mock.calls.some(([path]) => typeof path === 'string' && path.includes('maxRent=700'))).toBe(true)
    expect(apiMock.mock.calls.some(([path]) => typeof path === 'string' && path.includes('maxDistanceKm=5') && path.includes('sort=distance') && path.includes('recentlyConfirmed=true'))).toBe(true)
  })

  it('warns students about stale availability in search and on the listing detail', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/campuses') return { items: [] }
      if (path.startsWith('/listings?')) return { items: [
        { id: 'stale-listing', title: 'Older listing', rent: 650, status: 'PUBLISHED', availabilityStale: true },
        { id: 'fresh-listing', title: 'Recently confirmed listing', rent: 700, status: 'PUBLISHED', availabilityStale: false },
      ], total: 2, page: 1, pages: 1 }
      if (path === '/listings/stale-listing') return { id: 'stale-listing', title: 'Older listing', rent: 650, status: 'PUBLISHED', availabilityStale: true, lastConfirmedAt: null }
      if (path === '/listings/stale-listing/reviews?page=1&limit=10') return { items: [], total: 0, page: 1, pages: 1 }
      throw new Error(`Unexpected API call: ${path}`)
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/listings']}><Routes>
      <Route path="/listings" element={<ListingsPage />} />
      <Route path="/listings/:id" element={<ListingDetailPage />} />
    </Routes></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText('Older listing')).toBeTruthy()
    expect(screen.getAllByText('Availability needs reconfirmation.')).toHaveLength(1)
    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: 'View listing: Older listing' }))
    expect(await screen.findByText("The owner has not confirmed this listing's availability within the last 30 days. Check with them before arranging a viewing.")).toBeTruthy()
    expect(screen.getByText('Availability needs reconfirmation.')).toBeTruthy()
  })
})
