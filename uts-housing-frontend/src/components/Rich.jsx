import { Fragment } from 'react';
import { useT } from '../i18n';

/**
 * Translated text with simple bold markup: "Upload your <b>offer letter</b>".
 * Translators keep the <b>…</b> tags around the words that should stay bold.
 */
export default function Rich({ text, vars }) {
    const { t } = useT();
    const parts = t(text, vars).split(/<b>(.*?)<\/b>/g);
    return parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>));
}
