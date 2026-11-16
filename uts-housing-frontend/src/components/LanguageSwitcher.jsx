import { LANGUAGES, useT } from '../i18n';

/** Compact language picker (EN / BM / 中文). `dark` for dark headers. */
export default function LanguageSwitcher({ dark = false, className = '' }) {
    const { t, lang, setLang } = useT();
    return (
        <label className={`inline-flex items-center gap-1 ${className}`}>
            <span aria-hidden="true" className={dark ? 'text-gray-300' : 'text-gray-500'}>🌐</span>
            <span className="sr-only">{t('Language')}</span>
            <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                aria-label={t('Language')}
                className={`text-[13px] font-bold rounded-md px-1.5 py-1 outline-none cursor-pointer border ${dark ? 'bg-transparent text-white border-white/30 [&>option]:text-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-[#203569]'}`}
            >
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
        </label>
    );
}
