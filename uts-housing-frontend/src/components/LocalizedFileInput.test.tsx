// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { I18nProvider, LanguageSwitcher } from '../lib/i18n'
import { LocalizedFileInput } from './LocalizedFileInput'

beforeEach(() => window.localStorage.removeItem('uts-housing-language-v2'))
afterEach(() => cleanup())

function Example() {
  const [file, setFile] = useState<File | null>(null)
  return <I18nProvider><LanguageSwitcher /><label>Identity document
    <LocalizedFileInput accept="image/png" selected={file} onChange={event => setFile(event.currentTarget.files?.[0] || null)} />
  </label></I18nProvider>
}

it('translates the visible chooser and preserves the selected filename', async () => {
  const user = userEvent.setup()
  const { container } = render(<Example />)
  expect(screen.getByText('Choose file')).toBeTruthy()
  expect(screen.getByText('No file selected')).toBeTruthy()
  await user.selectOptions(screen.getByRole('combobox'), 'ms')
  expect(screen.getByText('Pilih fail')).toBeTruthy()
  expect(screen.getByText('Tiada fail dipilih')).toBeTruthy()
  await user.selectOptions(screen.getByRole('combobox'), 'zh-CN')
  expect(screen.getByText('选择文件')).toBeTruthy()
  const file = new File(['test'], 'identity-test.png', { type: 'image/png' })
  await user.upload(container.querySelector('input[type=file]')!, file)
  expect(screen.getByText('identity-test.png')).toBeTruthy()
})
