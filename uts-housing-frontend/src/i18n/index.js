// Lightweight i18n: English is the source language and the key.
// Each message file maps an English string to [Bahasa Melayu, 中文].
// A string without a translation falls back to English, so nothing ever shows blank.
import { createContext, useContext } from 'react';
import common from './messages/common';
import auth from './messages/auth';
import student from './messages/student';
import landlord from './messages/landlord';
import admin from './messages/admin';
import server from './messages/server';

export const LANGUAGES = [
    { code: 'en', label: 'English', short: 'EN', locale: 'en-MY' },
    { code: 'ms', label: 'Bahasa Melayu', short: 'BM', locale: 'ms-MY' },
    { code: 'zh', label: '中文', short: '中文', locale: 'zh-CN' },
];

const STORAGE_KEY = 'uts_lang';
const COLUMN = { ms: 0, zh: 1 };
const ALL = { ...common, ...auth, ...student, ...landlord, ...admin, ...server };

/** All English keys with translations (used by the i18n check script). */
export const MESSAGES = ALL;

function initialLanguage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (LANGUAGES.some((l) => l.code === saved)) return saved;
    } catch { /* storage blocked */ }
    const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
    if (nav.startsWith('ms')) return 'ms';
    if (nav.startsWith('zh')) return 'zh';
    return 'en';
}

let current = initialLanguage();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLanguage = () => current;
export const getLocale = () => LANGUAGES.find((l) => l.code === current)?.locale || 'en-MY';

/** Called by the provider when the user picks a language (event time, not render time). */
export function setLanguage(code) {
    current = code;
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage blocked */ }
    document.documentElement.lang = code;
}

/**
 * Translate an English string into the current language.
 * `{name}` placeholders are filled from `vars`.
 */
export function translate(key, vars) {
    if (key === undefined || key === null) return key;
    let text = String(key);
    if (current !== 'en') {
        const row = ALL[text];
        if (row && row[COLUMN[current]]) {
            text = row[COLUMN[current]];
        } else {
            // API validation errors look like "field: message" — translate the message part.
            const m = text.match(/^[\w.]+: (.+)$/);
            const tail = m && ALL[m[1]];
            if (tail && tail[COLUMN[current]]) text = tail[COLUMN[current]];
        }
    }
    if (vars) text = text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
    return text;
}

export const I18nContext = createContext({ lang: 'en', setLang: () => {} });

/** Re-renders the caller when the language changes; returns { t, lang, setLang }. */
export function useT() {
    const { lang, setLang } = useContext(I18nContext);
    return { t: translate, lang, setLang };
}
