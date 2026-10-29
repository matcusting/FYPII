import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { shellTranslations } from './locales/shell'
import { publicTranslations } from './locales/public'
import { accountTranslations } from './locales/account'
import { requestsTranslations } from './locales/requests'
import { listingsTranslations } from './locales/listings'
import { roommatesTranslations } from './locales/roommates'
import { adminTranslations } from './locales/admin'
import { apiErrorsAdmin } from './locales/apiErrorsAdmin'
import { landlordTranslations } from './locales/landlord'
import { landlordErrorTranslations } from './locales/landlordErrors'

export type Locale = 'en' | 'ms' | 'zh-CN'
type Variables = Record<string, string | number>
type Translation = { ms: string; zh: string }
// Reset older saved language choices once so English is the default for this release.
const storageKey = 'uts-housing-language-v2'
const dictionary: Record<string, Translation> = {
  ...shellTranslations, ...publicTranslations, ...accountTranslations, ...requestsTranslations,
  ...listingsTranslations, ...roommatesTranslations, ...adminTranslations, ...apiErrorsAdmin, ...landlordTranslations, ...landlordErrorTranslations,
}

function storedLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(storageKey)
    return saved === 'ms' || saved === 'zh-CN' ? saved : 'en'
  } catch { return 'en' }
}

let activeLocale: Locale = typeof window === 'undefined' ? 'en' : storedLocale()
export function currentLocale(): Locale { return activeLocale }

function renderText(english: string, locale: Locale, variables?: Variables): string {
  const translation = dictionary[english]
  const template = locale === 'ms' ? translation?.ms || english : locale === 'zh-CN' ? translation?.zh || english : english
  return variables ? template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, key: string) => String(variables[key] ?? whole)) : template
}

export function translate(english: string, variables?: Variables): string {
  return renderText(english, activeLocale, variables)
}

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (english: string, variables?: Variables) => string
}
const fallback: I18nContextValue = { locale: 'en', setLocale: () => {}, t: (english, variables) => renderText(english, 'en', variables) }
const I18nContext = createContext<I18nContextValue>(fallback)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(storedLocale)
  useEffect(() => {
    activeLocale = locale
    document.documentElement.lang = locale
    try { window.localStorage.setItem(storageKey, locale) } catch { /* Private browsing may block storage. */ }
  }, [locale])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey) return
      const next = event.newValue === 'ms' || event.newValue === 'zh-CN' ? event.newValue : 'en'
      activeLocale = next
      updateLocale(next)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: next => { activeLocale = next; updateLocale(next) },
    t: (english, variables) => renderText(english, locale, variables),
  }), [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue { return useContext(I18nContext) }

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()
  return <select aria-label={t('Language')} title={t('Language')} value={locale} onChange={event => setLocale(event.target.value as Locale)} className={className}>
    <option value="en">English</option>
    <option value="ms">Bahasa Melayu</option>
    <option value="zh-CN">简体中文</option>
  </select>
}
