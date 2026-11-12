import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AuthCard, ErrorBanner, FieldError, SuccessBanner, inputClass, labelClass } from '../components/ui';

const primaryBtn = 'w-full bg-[#203569] text-white font-bold py-3 px-4 rounded-lg hover:bg-[#1a2b56] transition shadow-sm disabled:opacity-70 cursor-pointer';
const backLink = <p className="mt-6 text-center text-[13px] font-bold"><Link to="/" className="text-[#203569] hover:underline">← Back to login</Link></p>;

export function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await api('/auth/forgot-password', { method: 'POST', body: { email } });
            setSent(true);
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <AuthCard title="Forgot Password">
            {sent ? (
                <SuccessBanner message="If an account exists for that e-mail, a reset link is on its way. It expires in 1 hour." />
            ) : (
                <form onSubmit={submit} className="space-y-5">
                    <ErrorBanner error={error} />
                    <p className="text-sm text-gray-500">Enter your account e-mail and we'll send you a link to choose a new password.</p>
                    <div>
                        <label htmlFor="email" className={labelClass}>Email</label>
                        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
                    </div>
                    <button type="submit" disabled={busy} className={primaryBtn}>{busy ? 'Sending...' : 'Send Reset Link'}</button>
                </form>
            )}
            {backLink}
        </AuthCard>
    );
}

export function ResetPassword() {
    const [params] = useSearchParams();
    const token = params.get('token') || '';
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [done, setDone] = useState(false);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        if (password !== confirm) return setError({ message: 'Passwords do not match.' });
        setBusy(true);
        try {
            await api('/auth/reset-password', { method: 'POST', body: { token, password } });
            setDone(true);
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <AuthCard title="Choose a New Password">
            {!token ? (
                <ErrorBanner error="This reset link is incomplete. Please use the link from your e-mail." />
            ) : done ? (
                <SuccessBanner message="Your password has been changed. All other sessions were signed out." />
            ) : (
                <form onSubmit={submit} className="space-y-5">
                    <ErrorBanner error={error} />
                    <div>
                        <label htmlFor="password" className={labelClass}>New Password</label>
                        <input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
                        <FieldError error={error} name="password" />
                    </div>
                    <div>
                        <label htmlFor="confirm" className={labelClass}>Confirm Password</label>
                        <input id="confirm" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
                    </div>
                    <button type="submit" disabled={busy} className={primaryBtn}>{busy ? 'Saving...' : 'Reset Password'}</button>
                </form>
            )}
            {backLink}
        </AuthCard>
    );
}

export function VerifyEmail() {
    const [params] = useSearchParams();
    const { refresh } = useAuth();
    const token = params.get('token');
    const [state, setState] = useState(token ? 'loading' : 'error');
    const [error, setError] = useState(token ? null : 'This verification link is incomplete.');
    const started = useRef(false);

    useEffect(() => {
        if (started.current || !token) return; // StrictMode runs effects twice; tokens are single-use
        started.current = true;
        api('/auth/verify-email', { method: 'POST', body: { token } })
            .then(() => { setState('done'); refresh(); })
            .catch((err) => { setState('error'); setError(err); });
    }, [token, refresh]);

    return (
        <AuthCard title="Email Verification">
            {state === 'loading' && <p className="text-center text-gray-500 font-bold text-sm">Verifying your e-mail...</p>}
            {state === 'done' && <SuccessBanner message="Your e-mail is verified. UTS student e-mails are now approved automatically." />}
            {state === 'error' && <ErrorBanner error={error} />}
            {backLink}
        </AuthCard>
    );
}
