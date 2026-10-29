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
  user: { id: 'landlord-1', name: 'Demo Landlord', email: 'landlord@demo.local', roles: ['LANDLORD'], emailVerified: false, studentVerified: false, verificationStatus: 'UNVERIFIED' },
}))

vi.mock('../../lib/api', async original => ({ ...(await original<typeof import('../../lib/api')>()), api: state.api }))
vi.mock('../../lib/auth', async original => ({ ...(await original<typeof import('../../lib/auth')>()), useAuth: () => ({ user: state.user, refresh: state.refresh }) }))
vi.mock('./AccountControls', () => ({ AccountControls: () => null }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<I18nProvider><QueryClientProvider client={client}><MemoryRouter><ProfilePage /></MemoryRouter></QueryClientProvider></I18nProvider>)
}

beforeEach(() => {
  window.localStorage.removeItem('uts-housing-language-v2')
  state.user.id = 'landlord-1'
  state.user.name = 'Demo Landlord'
  state.user.email = 'landlord@demo.local'
  state.user.roles = ['LANDLORD']
  state.user.emailVerified = false
  state.user.studentVerified = false
  state.user.verificationStatus = 'UNVERIFIED'
  state.refresh.mockReset().mockResolvedValue(state.user)
  state.api.mockReset().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/profile' && !init) return Promise.resolve({ displayName: state.user.name, phone: null })
    if (path === '/profile' && init?.method === 'PATCH') return Promise.resolve({ displayName: state.user.name, phone: '+60 12-345 6789' })
    if (path === '/landlord-verifications/me') return Promise.resolve({ status: 'APPROVED', latest: null })
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
    await waitFor(() => expect(state.api.mock.calls.filter(([path]) => path === '/landlord-verifications/me').length).toBeGreaterThan(1))
  })

  it('explains the impact of replacing approved identity documents before uploading a new file', async () => {
    state.user.emailVerified = true
    state.api.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/profile' && !init) return Promise.resolve({ displayName: state.user.name, phone: '+60 12-345 6789' })
      if (path === '/landlord-verifications/me') return Promise.resolve({ status: 'APPROVED', latest: null })
      if (path === '/landlord-verifications/identity' && init?.method === 'POST') return Promise.resolve({ status: 'PENDING' })
      throw new Error(`Unexpected API request: ${path}`)
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Replace Identity Documents' }))
    expect(screen.getByText(/withdraws current approval. Published listings will pause/)).toBeTruthy()
    const file = new File([new Uint8Array([255, 216, 255])], 'fictional-id.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText(/MyKad or passport photo/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Submit Identity for Review' }))
    await waitFor(() => expect(state.api).toHaveBeenCalledWith('/landlord-verifications/identity', expect.objectContaining({ method: 'POST' })))
    const [, options] = state.api.mock.calls.find(([path]) => path === '/landlord-verifications/identity') || []
    expect((options?.body as FormData).get('identity')).toBe(file)
  })

  it('shows student contact details without housing preferences or budget, and saves the phone', async () => {
    state.user.id = 'student-1'
    state.user.name = 'Demo Student'
    state.user.email = 'student@demo.local'
    state.user.roles = ['STUDENT']
    renderPage()
    expect(await screen.findByRole('textbox', { name: 'University' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /Full Legal Name/ })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Account Email' }) as HTMLInputElement).readOnly).toBe(true)
    expect(screen.getByRole('textbox', { name: 'Personal Bio / Roommate Notes' })).toBeTruthy()
    for (const removed of ['Preferred Location', 'Preferred Move-in Date', 'Housing Budget', 'Monthly Budget From', 'Monthly Budget To']) {
      expect(screen.queryByText(removed)).toBeNull()
    }
    await userEvent.type(screen.getByRole('textbox', { name: /Phone Number/ }), '+60 12-345 6789')
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(state.api).toHaveBeenCalledWith('/profile', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ displayName: 'Demo Student', university: null, bio: null, phone: '+60 12-345 6789' }),
    })))
  })

  it('lets a student save university details without supplying a phone number', async () => {
    state.user.id = 'student-1'
    state.user.name = 'Demo Student'
    state.user.email = 'student@demo.local'
    state.user.roles = ['STUDENT']
    renderPage()
    await userEvent.type(await screen.findByRole('textbox', { name: 'University' }), 'University of Technology Sarawak')
    expect((screen.getByRole('textbox', { name: 'Phone Number' }) as HTMLInputElement).required).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(state.api).toHaveBeenCalledWith('/profile', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ displayName: 'Demo Student', university: 'University of Technology Sarawak', bio: null, phone: null }),
    })))
  })

  it('shows the latest rejected review and submits both student documents together', async () => {
    state.user.id = 'student-1'
    state.user.name = 'Synthetic Student'
    state.user.email = 'synthetic@student.uts.edu.my'
    state.user.roles = ['STUDENT']
    state.user.emailVerified = true
    state.user.verificationStatus = 'PENDING'
    state.api.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/profile' && !init) return Promise.resolve({ displayName: state.user.name, verificationStatus: 'REJECTED' })
      if (path === '/verifications' && init?.method === 'POST') return Promise.resolve({ status: 'PENDING' })
      throw new Error(`Unexpected API request: ${path}`)
    })
    renderPage()
    expect(await screen.findByText('Your previous verification was not approved. You may submit new documents for review.')).toBeTruthy()
    await waitFor(() => expect(state.refresh).toHaveBeenCalled())
    const studentId = new File([new Uint8Array([255, 216, 255])], 'synthetic-id.jpg', { type: 'image/jpeg' })
    const offer = new File(['%PDF-1.7\n%%EOF'], 'synthetic-offer.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText(/Student ID photo/), studentId)
    await userEvent.upload(screen.getByLabelText(/Offer letter/), offer)
    await userEvent.click(screen.getByRole('button', { name: 'Submit Verification' }))
    await waitFor(() => expect(state.api).toHaveBeenCalledWith('/verifications', expect.objectContaining({ method: 'POST' })))
    const call = state.api.mock.calls.find(([path]) => path === '/verifications')
    const body = call?.[1]?.body as FormData
    expect(body.get('method')).toBe('DOCUMENTS')
    expect(body.get('studentId')).toBe(studentId)
    expect(body.get('offerLetter')).toBe(offer)
  })
})
