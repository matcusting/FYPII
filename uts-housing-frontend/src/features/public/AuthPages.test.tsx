// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ForgotPasswordPage, LoginPage, RegisterPage, VerifyEmailPage } from './AuthPages'

const { apiMock, signInMock } = vi.hoisted(() => ({ apiMock: vi.fn(), signInMock: vi.fn() }))
vi.mock('../../lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api: apiMock }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: null, signIn: signInMock }) }))

afterEach(() => { cleanup(); apiMock.mockReset(); signInMock.mockReset() })

describe('account forms', () => {
  it('explains where local verification codes go when SMTP is unavailable', async () => {
    apiMock.mockResolvedValue({ localOutbox: true })
    render(<MemoryRouter><VerifyEmailPage /></MemoryRouter>)
    expect(await screen.findByText(/Local email test mode: no message is sent to your inbox/)).toBeTruthy()
  })

  it('allows a new verification code to be requested after expiry', async () => {
    apiMock.mockResolvedValue({ accepted: true })
    render(<MemoryRouter><VerifyEmailPage /></MemoryRouter>)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Resend Verification Code' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Enter a valid email address.')
    expect(apiMock.mock.calls.every(([path]) => path === '/auth/delivery-mode')).toBe(true)
    await user.type(screen.getByLabelText('Email'), 'student@student.uts.edu.my')
    await user.click(screen.getByRole('button', { name: 'Resend Verification Code' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/auth/resend-verification', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ email: 'student@student.uts.edu.my' }),
    })))
    expect(await screen.findByText(/If this address belongs to an unverified account/)).toBeTruthy()
  })

  it('submits an email-bound six-character code', async () => {
    apiMock.mockResolvedValue({ verified: true })
    render(<MemoryRouter initialEntries={['/verify-email?email=student%40student.uts.edu.my']}><VerifyEmailPage /></MemoryRouter>)
    const user = userEvent.setup()
    expect(screen.getByLabelText('Email Address')).toHaveProperty('value', 'student@student.uts.edu.my')
    await user.type(screen.getByLabelText('Verification Code'), 'ab23cd')
    await user.click(screen.getByRole('button', { name: 'Verify Email' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/auth/verify-email', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ email: 'student@student.uts.edu.my', code: 'AB23CD' }),
    })))
  })

  it('shows local-only verification and reset links returned by the preview', async () => {
    apiMock.mockImplementation(async (path: string) => path === '/auth/delivery-mode' ? { localOutbox: false } : { accepted: true, demoVerificationToken: 'demo-verify-token' })
    const { unmount } = render(<MemoryRouter><VerifyEmailPage /></MemoryRouter>)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'preview-student@student.uts.edu.my')
    await user.click(screen.getByRole('button', { name: 'Resend Verification Code' }))
    const verificationLink = await screen.findByRole('link', { name: 'Open the demo email verification link' })
    expect(verificationLink.getAttribute('href')).toBe('/verify-email?token=demo-verify-token')
    await user.click(verificationLink)
    expect(screen.getByText(/This link is ready/)).toBeTruthy()
    unmount()

    apiMock.mockImplementation(async (path: string) => path === '/auth/delivery-mode' ? { localOutbox: false } : { accepted: true, demoResetToken: 'demo-reset-token' })
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
    await user.type(screen.getByLabelText('Email'), 'preview-student@student.uts.edu.my')
    await user.click(screen.getByRole('button', { name: 'Send Reset Instructions' }))
    expect((await screen.findByRole('link', { name: 'Open the demo password reset link' })).getAttribute('href')).toBe('/reset-password?token=demo-reset-token')
  })

  it('blocks invalid registration and submits only validated, accepted details', async () => {
    apiMock.mockResolvedValue({})
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'Student A')
    expect(screen.getByText(/Use your university-issued student email/)).toBeTruthy()
    expect(screen.getByPlaceholderText('studentid@student.uts.edu.my')).toBeTruthy()
    await user.type(screen.getByLabelText('University Student Email'), 'student-test@student.uts.edu.my')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'GoodPass123')
    await user.type(screen.getByLabelText('Confirm Password'), 'WrongPass123')
    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(await screen.findByText('The passwords do not match.')).toBeTruthy()
    expect(screen.getByText('Please read and accept the Terms of Use and Privacy Notice.')).toBeTruthy()
    expect(apiMock).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Confirm Password'))
    await user.type(screen.getByLabelText('Confirm Password'), 'GoodPass123')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/auth/register', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Student A', email: 'student-test@student.uts.edu.my', password: 'GoodPass123', role: 'STUDENT', acceptTerms: true }),
    })))
    expect(await screen.findByText(/Registration submitted/)).toBeTruthy()
  })

  it('requires a landlord phone number and sends it with registration', async () => {
    apiMock.mockResolvedValue({})
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Landlord' }))
    expect(screen.getByText(/Use the name shown on your identity document/)).toBeTruthy()
    await user.type(screen.getByLabelText('Full Legal Name'), 'Demo Landlord')
    await user.type(screen.getByLabelText('Email'), 'landlord@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'GoodPass123')
    await user.type(screen.getByLabelText('Confirm Password'), 'GoodPass123')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(await screen.findByText('Enter a valid phone number.')).toBeTruthy()
    expect(apiMock).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Phone Number *'), '+60 12-345 6789')
    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/auth/register', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Demo Landlord', email: 'landlord@example.com', phone: '+60 12-345 6789', password: 'GoodPass123', role: 'LANDLORD', acceptTerms: true }),
    })))
  })

  it('rejects malformed login details and ignores an external return URL', async () => {
    signInMock.mockResolvedValue({ roles: [] })
    render(<MemoryRouter initialEntries={['/login?next=%2F%2Fevil.example']}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/dashboard" element={<p>Dashboard opened</p>} /></Routes></MemoryRouter>)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'bad-email')
    await user.click(screen.getByRole('button', { name: 'Log In' }))
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy()
    expect(signInMock).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'student@example.com')
    await user.type(screen.getByLabelText('Password'), 'GoodPass123')
    await user.click(screen.getByRole('button', { name: 'Log In' }))
    expect(await screen.findByText('Dashboard opened')).toBeTruthy()
    expect(signInMock).toHaveBeenCalledWith('student@example.com', 'GoodPass123')
  })

  it.each([
    ['/login?next=%2Fstudent', 'Landlord dashboard opened'],
    ['/login?next=%2Flandlord%2Fmanage', 'Landlord listings opened'],
  ])('routes a landlord signing in from %s to an allowed destination', async (loginPath, expectedPage) => {
    signInMock.mockResolvedValue({ roles: ['LANDLORD'] })
    render(<MemoryRouter initialEntries={[loginPath]}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/landlord" element={<p>Landlord dashboard opened</p>} />
      <Route path="/landlord/manage" element={<p>Landlord listings opened</p>} />
      <Route path="/student" element={<p>Student dashboard opened</p>} />
    </Routes></MemoryRouter>)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'landlord@demo.local')
    await user.type(screen.getByLabelText('Password'), 'Demo12345!')
    await user.click(screen.getByRole('button', { name: 'Log In' }))
    expect(await screen.findByText(expectedPage)).toBeTruthy()
    expect(screen.queryByText('Student dashboard opened')).toBeNull()
  })
})
