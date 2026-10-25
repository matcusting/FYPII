// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../../lib/i18n'
import { ProfilePage } from './ProfilePage'

const state = vi.hoisted(() => ({
  api: vi.fn(),
  refresh: vi.fn(),
  user: { id: 'landlord-1', name: 'Demo Landlord', email: 'landlord@demo.local', roles: ['LANDLORD'] },
}))

vi.mock('../../lib/api', async original => ({ ...(await original<typeof import('../../lib/api')>()), api: state.api }))
vi.mock('../../lib/auth', async original => ({ ...(await original<typeof import('../../lib/auth')>()), useAuth: () => ({ user: state.user, refresh: state.refresh }) }))
vi.mock('./AccountControls', () => ({ AccountControls: () => null }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<I18nProvider><QueryClientProvider client={client}><MemoryRouter><ProfilePage /></MemoryRouter></QueryClientProvider></I18nProvider>)
}

beforeEach(() => {
  window.localStorage.removeItem('uts-housing-language')
  state.user.id = 'landlord-1'
  state.user.name = 'Demo Landlord'
  state.user.email = 'landlord@demo.local'
  state.user.roles = ['LANDLORD']
  state.refresh.mockReset().mockResolvedValue(state.user)
  state.api.mockReset().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/profile' && !init) return Promise.resolve({ displayName: state.user.name, phone: null })
    if (path === '/profile' && init?.method === 'PATCH') return Promise.resolve({ displayName: state.user.name, phone: '+60 12-345 6789' })
    throw new Error(`Unexpected API request: ${path}`)
  })
})
afterEach(() => cleanup())

describe('landlord profile', () => {
  it('shows only name, account email and phone, and saves the phone', async () => {
    renderPage()
    expect(await screen.findByRole('textbox', { name: /Phone Number/ })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /Full Legal Name/ })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Account Email' }) as HTMLInputElement).readOnly).toBe(true)
    for (const removed of ['University', 'Preferred Location', 'Preferred Move-in Date', 'Personal Bio / Roommate Notes', 'Housing Budget']) {
      expect(screen.queryByText(removed)).toBeNull()
    }
    await userEvent.type(screen.getByRole('textbox', { name: /Phone Number/ }), '+60 12-345 6789')
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(state.api).toHaveBeenCalledWith('/profile', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ displayName: 'Demo Landlord', phone: '+60 12-345 6789' }),
    })))
  })

  it('keeps student housing preferences and budget visible', async () => {
    state.user.id = 'student-1'
    state.user.roles = ['STUDENT']
    renderPage()
    expect(await screen.findByRole('textbox', { name: 'University' })).toBeTruthy()
    expect(screen.getByText('Housing Budget')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /Phone Number/ })).toBeNull()
  })
})
