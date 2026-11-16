import { useCallback, useMemo, useState } from 'react';
import { I18nContext, getLanguage, setLanguage } from './index';

export default function I18nProvider({ children }) {
    const [lang, setLangState] = useState(getLanguage);
    const setLang = useCallback((code) => {
        setLanguage(code);
        setLangState(code);
    }, []);
    const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
