// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ListingsPage } from './search'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api: apiMock }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: null }) }))

afterEach(() => { cleanup(); apiMock.mockReset() })

describe('listing search', () => {
  it('sends filters to the API and displays approved server results', async () => {
    apiMock.mockImplementation(async (path: string) => path === '/campuses' ? [{ id: 'campus-1', name: 'Main Campus' }] : { items: [{ id: 'listing-1', title: '真实房源', rent: '650.00', currency: 'MYR', status: 'PUBLISHED' }], total: 1, page: 1, pages: 1 })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><ListingsPage /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText('真实房源')).toBeTruthy()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('校区'), 'campus-1')
    await user.type(screen.getByLabelText('最高月租 (RM)'), '700')
    await user.click(screen.getByRole('button', { name: '应用筛选' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('campusId=campus-1')))
    expect(apiMock.mock.calls.some(([path]) => typeof path === 'string' && path.includes('maxRent=700'))).toBe(true)
  })
})
