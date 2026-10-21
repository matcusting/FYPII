// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EnglishDateInput, isIsoDate } from './EnglishDateInput'

afterEach(cleanup)

describe('English date input', () => {
  it('accepts real ISO dates, including leap days', () => {
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('10/21/2026')).toBe(false)
  })

  it('shows an English calendar and returns an ISO date', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(<EnglishDateInput value="2026-10-21" onValueChange={onValueChange} />)
    expect(screen.getByPlaceholderText('YYYY-MM-DD').getAttribute('type')).toBe('text')
    await user.click(screen.getByRole('button', { name: 'Choose date' }))
    expect(screen.getByText('October 2026')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Thursday, October 22, 2026' }))
    expect(onValueChange).toHaveBeenCalledWith('2026-10-22')
  })
})
