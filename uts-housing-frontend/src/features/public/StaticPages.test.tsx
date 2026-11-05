// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../../lib/i18n'
import { StaticPage } from './StaticPages'

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('public review disclosures', () => {
  it('explains a lawyer recommendation is scoped and the administrator decides', () => {
    render(<MemoryRouter><I18nProvider><StaticPage kind="privacy" /></I18nProvider></MemoryRouter>)
    expect(screen.getByText('External Legal Review')).toBeTruthy()
    expect(screen.getByText(/A platform administrator makes the final website approval decision/)).toBeTruthy()
    expect(screen.getAllByText(/written engagement/).length).toBeGreaterThan(0)
    expect(screen.getByText(/independently operated by an individual project owner/)).toBeTruthy()
    expect(screen.getByText(/Marcus Ting Zhong Sheng/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'matcusting@gmail.com' }).getAttribute('href')).toBe('mailto:matcusting@gmail.com')
    expect(screen.getByText(/An approved student's verified status ends after the study end date/)).toBeTruthy()
    expect(screen.getByText(/one calendar year after that date/)).toBeTruthy()
    expect(screen.getByText(/two calendar years after approval expiry/)).toBeTruthy()
    expect(screen.getByText(/two calendar years after rejection/)).toBeTruthy()
  })

  it('explains the same responsibility in Simplified Chinese', () => {
    window.localStorage.setItem('uts-housing-language-v2', 'zh-CN')
    render(<MemoryRouter><I18nProvider><StaticPage kind="terms" /><StaticPage kind="help" /></I18nProvider></MemoryRouter>)
    expect(screen.getByText('房东审核')).toBeTruthy()
    expect(screen.getByText(/获分配案件的律师审核员核对房东身份或房源出租授权/)).toBeTruthy()
    expect(screen.getAllByText(/平台管理员作出网站的最终决定/).length).toBeGreaterThan(0)
    expect(screen.getByText('谁核对房东资料？')).toBeTruthy()
    expect(screen.getByText(/律师楼已书面接受委托/)).toBeTruthy()
  })

  it('translates the proposed document periods without claiming automatic deletion', () => {
    window.localStorage.setItem('uts-housing-language-v2', 'zh-CN')
    render(<MemoryRouter><I18nProvider><StaticPage kind="privacy" /></I18nProvider></MemoryRouter>)
    expect(screen.getByText(/在校结束日期/)).toBeTruthy()
    expect(screen.getByText(/必须重新审核/)).toBeTruthy()
    expect(screen.getByText(/两个日历年后可清除/)).toBeTruthy()
    expect(screen.getByText(/拒绝满两个日历年后可清除/)).toBeTruthy()
    expect(screen.getByText(/定期执行清除及备份期限仍须运营方另行批准/)).toBeTruthy()
  })

  it('shows the document periods in Bahasa Melayu', () => {
    window.localStorage.setItem('uts-housing-language-v2', 'ms')
    render(<MemoryRouter><I18nProvider><StaticPage kind="privacy" /></I18nProvider></MemoryRouter>)
    expect(screen.getByText(/satu tahun kalendar selepas tarikh tersebut/)).toBeTruthy()
    expect(screen.getByText(/dua tahun kalendar selepas kelulusan tamat tempoh/)).toBeTruthy()
  })
})
