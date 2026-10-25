// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nProvider } from '../../lib/i18n'
import { RoommateProfilePage } from '../roommates/Profile'
import { DashboardPage } from './DashboardPage'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', async original => ({ ...(await original<typeof import('../../lib/api')>()), api: apiMock }))
vi.mock('../../lib/auth', async original => ({
  ...(await original<typeof import('../../lib/auth')>()),
  useAuth: () => ({
    user: { id: 'student-1', name: 'Demo Student', email: 'student@demo.local', roles: ['STUDENT'], studentVerified: true },
    loading: false,
    signOut: vi.fn(),
  }),
}))

afterEach(() => { cleanup(); apiMock.mockReset() })

describe('student roommate entry', () => {
  it('opens My Lifestyle Profile directly and hides legacy university sharing controls', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/inquiries' || path === '/roommates/blocks') return { items: [] }
      if (path === '/roommates/profile') return {
        displayName: 'Demo Student', university: 'Legacy University', visibility: { university: true }, discoverable: true,
      }
      throw new Error(`Unexpected API request: ${path}`)
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<I18nProvider><QueryClientProvider client={client}><MemoryRouter initialEntries={['/student']}>
      <Routes>
        <Route path="/student" element={<DashboardPage />} />
        <Route path="/roommates/profile" element={<RoommateProfilePage />} />
      </Routes>
    </MemoryRouter></QueryClientProvider></I18nProvider>)

    const findRoommate = await screen.findByRole('link', { name: /Find a Roommate/ })
    expect(findRoommate.getAttribute('href')).toBe('/roommates/profile')
    await userEvent.click(findRoommate)
    expect(await screen.findByRole('heading', { name: 'My Lifestyle Profile' })).toBeTruthy()
    expect(await screen.findByLabelText('Display Name')).toBeTruthy()
    expect(screen.queryByLabelText('University')).toBeNull()
    expect(screen.queryByText('Show university to matches')).toBeNull()
    expect(screen.queryByText('Lifestyle Profile Builder')).toBeNull()
  })
})
