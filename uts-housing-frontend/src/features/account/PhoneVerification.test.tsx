// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../../lib/i18n'
import { PhoneVerification } from './PhoneVerification'

const state = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../lib/api', async original => ({ ...(await original<typeof import('../../lib/api')>()), api: state.api }))
vi.mock('../../lib/auth', async original => ({ ...(await original<typeof import('../../lib/auth')>()), useAuth: () => ({ user: { id: 'fictional-user', emailVerified: true } }) }))

afterEach(() => { cleanup(); state.api.mockReset() })

it('labels local SMS outbox completion as a test, never verified phone ownership', async () => {
  state.api.mockImplementation((path: string, options?: RequestInit) => {
    if (path === '/phone-verification' && !options) return Promise.resolve({ phone: '012-345 6789', verified: false, testCompleted: false, available: true, localOutbox: true })
    if (path === '/phone-verification/request' && options?.method === 'POST') return Promise.resolve({ accepted: true })
    if (path === '/phone-verification/confirm' && options?.method === 'POST') return Promise.resolve({ verified: false, testCompleted: true })
    throw new Error(`Unexpected API request: ${path}`)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<I18nProvider><QueryClientProvider client={client}><MemoryRouter><PhoneVerification phone="012-345 6789" /></MemoryRouter></QueryClientProvider></I18nProvider>)
  expect(await screen.findByText(/no real SMS is sent/i)).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Send verification code' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Six-digit SMS code' }), '123456')
  await userEvent.click(screen.getByRole('button', { name: 'Verify Phone' }))
  expect(await screen.findByText('Local SMS test completed. This does not verify phone ownership.')).toBeTruthy()
  expect(state.api).toHaveBeenCalledWith('/phone-verification/confirm', expect.objectContaining({ body: JSON.stringify({ code: '123456' }) }))
})
