// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LoginPage, RegisterPage } from './AuthPages'

const { apiMock, signInMock } = vi.hoisted(() => ({ apiMock: vi.fn(), signInMock: vi.fn() }))
vi.mock('../../lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('../../lib/api')>()), api: apiMock }))
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: null, signIn: signInMock }) }))

afterEach(() => { cleanup(); apiMock.mockReset(); signInMock.mockReset() })

describe('account forms', () => {
  it('blocks invalid registration and submits only validated, accepted details', async () => {
    apiMock.mockResolvedValue({})
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'Student A')
    await user.type(screen.getByLabelText('Email'), 'student@example.com')
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
      body: JSON.stringify({ name: 'Student A', email: 'student@example.com', password: 'GoodPass123', role: 'STUDENT', acceptTerms: true }),
    })))
    expect(await screen.findByText(/Registration submitted/)).toBeTruthy()
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
