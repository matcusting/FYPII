// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AdminEmailDeliveryPage } from './AdminEmailDeliveryPage'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api: apiMock }))

afterEach(() => { cleanup(); apiMock.mockReset() })

describe('admin email delivery page', () => {
  it('explains that local outbox messages are not real delivered email', async () => {
    apiMock.mockResolvedValue({ mode: 'localOutbox', senderConfigured: false, issue: null, queue: {
      pending: 2, retrying: 0, exhausted: 0, acceptedByTransport: 1, latestAcceptedAt: null,
    } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter><AdminEmailDeliveryPage /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText('Local outbox only')).toBeTruthy()
    expect(screen.getByText(/They are not sent to real inboxes/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check SMTP connection' }).hasAttribute('disabled')).toBe(true)
    expect(apiMock).toHaveBeenCalledWith('/operations/email-delivery')
  })
})
