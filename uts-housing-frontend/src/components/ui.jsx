import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, homeFor } from '../lib/api';
import { translate as t, useT } from '../i18n';
import LanguageSwitcher from './LanguageSwitcher';

/* ---------- Route guard (UI only — the API enforces every permission) ---------- */
export function RequireAuth({ roles, children }) {
    const { user, loading } = useAuth();
    const location = useLocation();
    if (loading) return <FullPageLoading />;
    if (!user) return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />;
    if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
    return children;
}

export function FullPageLoading() {
    useT();
    return (
        <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center font-sans">
            <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-[#203569] text-white rounded-full flex items-center justify-center text-2xl font-bold tracking-wide animate-pulse">UTS</div>
                <p className="text-gray-500 text-sm font-bold">{t('Loading...')}</p>
            </div>
        </div>
    );
}

export function LoadingBlock({ text = 'Loading...' }) {
    useT();
    return (
        <div className="h-48 flex flex-col items-center justify-center text-center" role="status" aria-live="polite">
            <div className="w-8 h-8 border-4 border-gray-200 border-t-[#203569] rounded-full animate-spin mb-3"></div>
            <p className="text-sm text-gray-500 font-bold">{t(text)}</p>
        </div>
    );
}

export function ErrorBanner({ error, className = '' }) {
    useT();
    if (!error) return null;
    const message = t(typeof error === 'string' ? error : error.message);
    return (
        <div role="alert" className={`bg-[#fee2e2] text-[#b91c1c] p-4 rounded-lg font-bold text-sm border border-[#fecaca] text-center ${className}`}>
            {message}
        </div>
    );
}

export function SuccessBanner({ message, className = '' }) {
    useT();
    if (!message) return null;
    return (
        <div role="status" className={`bg-[#dcfce7] text-[#15803d] p-4 rounded-lg font-bold text-sm border border-[#bbf7d0] text-center ${className}`}>
            ✓ {t(message)}
        </div>
    );
}

export function EmptyState({ icon = '🔍', title, text, action }) {
    useT();
    return (
        <div className="h-64 flex flex-col items-center justify-center text-center">
            <div className="text-4xl mb-4">{icon}</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">{t(title)}</h3>
            {text && <p className="text-sm text-gray-500 max-w-sm">{t(text)}</p>}
            {action}
        </div>
    );
}

/** Yellow notice shown while e-mail / student / landlord verification is incomplete. */
export function VerificationBanner({ className = '' }) {
    const { user, verification, refresh } = useAuth();
    useT();
    const [sent, setSent] = useState(false);
    const [error, setError] = useState(null);
    if (!user || user.role === 'ADMIN' || user.role === 'LEGAL_REVIEWER') return null;

    const resend = async () => {
        setError(null);
        try {
            await api('/auth/resend-verification', { method: 'POST' });
            setSent(true);
        } catch (e) {
            setError(e.message);
        }
    };

    let content = null;
    if (!user.emailVerified) {
        content = (
            <>
                <span>📧 {t('Please confirm your e-mail address ({email}) to unlock all features.', { email: user.email })}</span>
                {sent ? (
                    <span className="text-[#15803d]">✓ {t('Link sent — check your inbox.')}</span>
                ) : (
                    <button onClick={resend} className="underline cursor-pointer">{t('Resend link')}</button>
                )}
                <button onClick={refresh} className="underline cursor-pointer">{t("I've verified")}</button>
            </>
        );
    } else if (user.role === 'STUDENT' && !user.studentVerified) {
        content = verification?.status === 'REJECTED' ? (
            <span>⚠️ {t('Your student verification was not approved.')}{verification.decisionNote ? ` ${verification.decisionNote}` : ''} <Link to="/student/profile" className="underline">{t('Upload new documents')}</Link></span>
        ) : verification?.status === 'PENDING' ? (
            <span>⏳ {t('An administrator is checking your offer letter and student card. Roommate matching and reviews unlock once approved.')}</span>
        ) : (
            <span>📄 {t('Upload your offer letter and student card to get verified.')} <Link to="/student/profile" className="underline">{t('Go to My Profile')}</Link></span>
        );
    } else if (user.role === 'LANDLORD' && !user.landlordVerified) {
        content = verification?.status === 'REJECTED' ? (
            <span>⚠️ {t('Your landlord verification was not approved.')}{verification.decisionNote ? ` ${verification.decisionNote}` : ''} {t('Upload new documents in Account Settings.')}</span>
        ) : verification?.status === 'PENDING' ? (
            <span>⏳ {t('The legal reviewer is checking your identity documents. You can prepare listings meanwhile; they can be submitted once you are verified.')}</span>
        ) : (
            <span>📄 {t('Upload your identity card in Account Settings so the legal reviewer can verify you. Listings can only be submitted after that.')}</span>
        );
    }
    if (!content) return null;
    return (
        <div className={`bg-[#fefce8] border border-[#fef08a] text-[#a16207] text-[13px] font-bold px-5 py-3 rounded-lg flex flex-wrap gap-x-4 gap-y-1 items-center ${className}`}>
            {content}
            {error && <span className="text-[#b91c1c]">{error}</span>}
        </div>
    );
}

/* ---------------------------------- Stars ---------------------------------- */
export function Stars({ value = 0, className = 'text-lg' }) {
    const v = Math.round(value);
    return (
        <span className={`text-[#eab308] tracking-widest ${className}`} aria-label={t('{n} out of 5 stars', { n: value })}>
            {'★'.repeat(v)}
            <span className="text-gray-300">{'★'.repeat(5 - v)}</span>
        </span>
    );
}

export function StarInput({ value, onChange }) {
    return (
        <div className="flex gap-1" role="radiogroup" aria-label={t('Rating')}>
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={value === n}
                    aria-label={t('{n} out of 5 stars', { n })}
                    onClick={() => onChange(n)}
                    className={`text-2xl cursor-pointer transition-colors ${n <= value ? 'text-[#eab308]' : 'text-gray-300 hover:text-gray-400'}`}
                >
                    ★
                </button>
            ))}
        </div>
    );
}

/* ------------------------------ Report dialog ------------------------------ */
export function ReportDialog({ targetType, targetId, label, onClose }) {
    useT();
    const [reasons, setReasons] = useState([]);
    const [reason, setReason] = useState('');
    const [details, setDetails] = useState('');
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        api('/meta').then((m) => setReasons(m.reportReasons)).catch(() => {});
    }, []);

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await api('/reports', { method: 'POST', body: { targetType, targetId, reason, details: details || undefined } });
            setDone(true);
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div onClick={onClose} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('Report')} className="bg-white rounded-xl shadow-2xl w-full max-w-[460px] overflow-hidden">
                <div className="bg-[#0f172a] px-6 py-4 flex justify-between items-center">
                    <h3 className="text-white font-bold text-[1.1rem]">{t('Report')} {t(label)}</h3>
                    <button onClick={onClose} aria-label={t('Close')} className="text-gray-400 hover:text-white text-xl leading-none font-bold cursor-pointer">×</button>
                </div>
                {done ? (
                    <div className="p-6 space-y-4">
                        <SuccessBanner message="Thank you. Our administrators will review this report." />
                        <div className="flex justify-end">
                            <button onClick={onClose} className="px-6 py-2.5 bg-[#203569] text-white font-bold rounded-md hover:bg-[#1a2b56] transition cursor-pointer">{t('Close')}</button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={submit} className="p-6 space-y-4">
                        <ErrorBanner error={error} />
                        <div>
                            <label htmlFor="report-reason" className="block text-[13px] font-bold text-[#374151] mb-1.5">{t('Reason')}</label>
                            <select id="report-reason" required value={reason} onChange={(e) => setReason(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800 bg-white">
                                <option value="">{t('Select a reason…')}</option>
                                {reasons.map((r) => <option key={r} value={r}>{t(r)}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="report-details" className="block text-[13px] font-bold text-[#374151] mb-1.5">{t('Details (optional)')}</label>
                            <textarea id="report-details" rows="3" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} className="w-full p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800" placeholder={t('Tell us what happened...')}></textarea>
                        </div>
                        <div className="pt-2 flex justify-end gap-3 border-t border-gray-100">
                            <button type="button" onClick={onClose} className="px-5 py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-md transition cursor-pointer">{t('Cancel')}</button>
                            <button type="submit" disabled={busy} className="px-6 py-2.5 bg-[#e11d48] text-white font-bold rounded-md hover:bg-red-700 transition shadow-sm cursor-pointer disabled:opacity-60">
                                {busy ? t('Sending...') : t('Submit Report')}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

/* ---------------- Card wrapper shared by login / register / reset pages ---------------- */
export function AuthCard({ title, subtitle = 'Housing & Roommate Finder', children, wide = false }) {
    useT();
    return (
        <div className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-center font-sans px-4 py-8 relative">
            <LanguageSwitcher className="absolute top-4 right-4" />
            <div className={`bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-gray-100 p-6 sm:p-10 w-full ${wide ? 'max-w-[520px]' : 'max-w-[420px]'}`}>
                <div className="flex flex-col items-center mb-6">
                    <div className="w-16 h-16 bg-[#203569] text-white rounded-full flex items-center justify-center text-2xl font-bold mb-4 tracking-wide">UTS</div>
                    <h2 className="text-[1.6rem] font-bold text-[#1f2937] mb-1 text-center">{t(title)}</h2>
                    <p className="text-gray-500 text-[14px] text-center">{t(subtitle)}</p>
                </div>
                {children}
            </div>
        </div>
    );
}

export const inputClass =
    'w-full p-2.5 border border-gray-300 rounded-lg focus:border-[#203569] outline-none text-gray-800 transition-colors';
export const labelClass = 'block text-[13px] font-bold text-[#203569] mb-1.5';

export function FieldError({ error, name }) {
    useT();
    const msg = error?.fields?.[name];
    return msg ? <p className="text-[12px] text-[#b91c1c] font-bold mt-1">{t(msg)}</p> : null;
}
