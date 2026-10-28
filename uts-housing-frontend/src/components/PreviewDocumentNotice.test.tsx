// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '../lib/i18n'
import { PreviewDocumentNotice, isLocalPreview } from './PreviewDocumentNotice'

function markPreview() {
  const marker = document.createElement('meta')
  marker.name = 'uts-housing-preview'
  marker.content = 'true'
  document.head.append(marker)
}

beforeEach(() => {
  window.localStorage.removeItem('uts-housing-language')
  document.querySelector('meta[name="uts-housing-preview"]')?.remove()
})
afterEach(() => {
  cleanup()
  document.querySelector('meta[name="uts-housing-preview"]')?.remove()
})

describe('preview document notices', () => {
  it('does not warn on the real API website', () => {
    expect(isLocalPreview()).toBe(false)
    render(<I18nProvider><PreviewDocumentNotice /></I18nProvider>)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('warns uploaders before they submit files in the local preview', () => {
    markPreview()
    expect(isLocalPreview()).toBe(true)
    render(<I18nProvider><PreviewDocumentNotice /></I18nProvider>)
    expect(screen.getByRole('note').textContent).toContain('discarded immediately')
    expect(screen.getByRole('note').textContent).toContain('Do not upload real documents')
  })

  it('explains placeholder downloads to reviewers in Simplified Chinese', () => {
    markPreview()
    window.localStorage.setItem('uts-housing-language', 'zh-CN')
    render(<I18nProvider><PreviewDocumentNotice reviewer /></I18nProvider>)
    expect(screen.getByRole('note').textContent).toContain('申请人上传的原件已被丢弃')
  })
})
