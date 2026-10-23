// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { RequestsPage } from './RequestsPage'

const state = vi.hoisted(() => ({
  api: vi.fn(),
  refresh: vi.fn(),
  user: { id: 'landlord-demo', name: 'Demo Landlord', roles: ['LANDLORD'] },
}))
vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, api: state.api }
})
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: state.user, refresh: state.refresh }),
  hasRole: (user: { roles?: string[] } | null, ...roles: string[]) => !!user && roles.some(role => user.roles?.includes(role)),
}))
vi.mock('../../lib/i18n', () => {
  const translate = (english: string, variables?: Record<string, string>) => variables ? english.replace(/\{(\w+)\}/g, (_, key: string) => variables[key] || '') : english
  return { translate, currentLocale: () => 'en', useI18n: () => ({ t: translate, locale: 'en' }) }
})

const inquiry = {
  id: 'inquiry-1', listingId: 'listing-1', listing: { id: 'listing-1', title: 'Demo room' },
  senderId: 'student-demo', recipientId: 'landlord-demo',
  sender: { id: 'student-demo', name: 'Demo Student' }, recipient: { id: 'landlord-demo', name: 'Demo Landlord' },
  message: 'Hello, is this room available?', status: 'OPEN', createdAt: '2026-10-01T09:00:00.000Z',
}
const messages = [
  { id: 'message-1', senderId: 'student-demo', body: inquiry.message, createdAt: '2026-10-01T09:00:00.000Z' },
  { id: 'message-2', senderId: 'landlord-demo', body: 'Yes, it is available.', createdAt: '2026-10-01T09:01:00.000Z' },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return { ...render(<QueryClientProvider client={client}><MemoryRouter><RequestsPage /></MemoryRouter></QueryClientProvider>), client }
}

beforeEach(() => {
  state.user.id = 'landlord-demo'
  state.user.name = 'Demo Landlord'
  state.user.roles = ['LANDLORD']
  state.api.mockReset()
  state.refresh.mockReset()
  state.api.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/inquiries?page=1&limit=20') return Promise.resolve({ items: [inquiry], page: 1, pages: 1 })
    if (path === '/inquiries/inquiry-1/messages?page=1&limit=20') return Promise.resolve({ items: messages, page: 1, pages: 1 })
    if (path === '/auth/me') return Promise.resolve({ id: 'landlord-demo' })
    if (path === '/inquiries/inquiry-1/messages' && init?.method === 'POST') return Promise.resolve({ id: 'new', senderId: 'landlord-demo' })
    throw new Error(`Unexpected API request: ${path}`)
  })
})
afterEach(() => { cleanup(); vi.clearAllTimers() })

describe('landlord inquiry messages', () => {
  it('shows the student on the incoming side and the landlord on the outgoing side', async () => {
    renderPage()
    expect((await screen.findByRole('article', { name: 'Message from Demo Student' })).getAttribute('data-direction')).toBe('incoming')
    expect(screen.getByRole('article', { name: 'Your message' }).getAttribute('data-direction')).toBe('outgoing')
  })

  it('refuses to send when another tab has switched the browser session to the student', async () => {
    state.api.mockImplementation((path: string) => {
      if (path === '/inquiries?page=1&limit=20') return Promise.resolve({ items: [inquiry], page: 1, pages: 1 })
      if (path === '/inquiries/inquiry-1/messages?page=1&limit=20') return Promise.resolve({ items: messages, page: 1, pages: 1 })
      if (path === '/auth/me') return Promise.resolve({ id: 'student-demo' })
      throw new Error(`Unexpected API request: ${path}`)
    })
    renderPage()
    await screen.findByRole('article', { name: 'Your message' })
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply' }), 'Please visit tomorrow.')
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce())
    expect(state.api).not.toHaveBeenCalledWith('/inquiries/inquiry-1/messages', expect.anything())
    expect(await screen.findByText('Your signed-in account changed. Reload this page before sending a message.')).toBeTruthy()
  })

  it('binds an outgoing reply to the landlord identity', async () => {
    renderPage()
    await screen.findByRole('article', { name: 'Your message' })
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply' }), 'Please visit tomorrow.')
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(state.api).toHaveBeenCalledWith('/inquiries/inquiry-1/messages', expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'Please visit tomorrow.', expectedSenderId: 'landlord-demo' }) })))
  })

  it('discards a landlord draft when the active account changes', async () => {
    const view = renderPage()
    await screen.findByRole('article', { name: 'Your message' })
    await userEvent.type(screen.getByRole('textbox', { name: 'Reply' }), 'Landlord-only draft')
    state.user.id = 'student-demo'
    state.user.name = 'Demo Student'
    state.user.roles = ['STUDENT']
    view.rerender(<QueryClientProvider client={view.client}><MemoryRouter><RequestsPage /></MemoryRouter></QueryClientProvider>)
    expect((await screen.findByRole('textbox', { name: 'Reply' }) as HTMLInputElement).value).toBe('')
  })
})
