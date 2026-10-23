// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider, LanguageSwitcher, useI18n } from './i18n'
import { ApiError, messageOf } from './api'

beforeEach(() => window.localStorage.removeItem('uts-housing-language'))
afterEach(() => cleanup())

function Example() {
  const { t } = useI18n()
  return <><LanguageSwitcher /><h1>{t('Dashboard')}</h1><p>{messageOf(new ApiError('Unexpected backend validation text.', 400, 'VALIDATION_ERROR'))}</p></>
}

describe('language switching', () => {
  it('starts in English, switches to Malay and Chinese, and remembers the choice', async () => {
    render(<I18nProvider><Example /></I18nProvider>)
    const picker = screen.getByRole('combobox', { name: 'Language' })
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    await userEvent.selectOptions(picker, 'ms')
    expect(screen.getByRole('heading', { name: 'Papan pemuka' })).toBeTruthy()
    expect(screen.getByText('Semak maklumat anda dan cuba lagi.')).toBeTruthy()
    await waitFor(() => expect(document.documentElement.lang).toBe('ms'))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Bahasa' }), 'zh-CN')
    expect(screen.getByRole('heading', { name: '控制台' })).toBeTruthy()
    expect(screen.getByText('请检查填写的信息后重试。')).toBeTruthy()
    await waitFor(() => expect(window.localStorage.getItem('uts-housing-language')).toBe('zh-CN'))
  })
})
