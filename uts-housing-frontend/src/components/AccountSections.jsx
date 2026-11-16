import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAX_DOCUMENT_MB, api, tooLarge } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ErrorBanner, FieldError, Stars, SuccessBanner } from './ui';
import { DocumentLinks, FileField } from './Documents';

const sectionTitle = 'text-[1.1rem] font-bold text-[#1f2937] border-b border-gray-100 pb-3 mb-5';
const input = 'w-full p-2.5 border border-gray-300 rounded-lg outline-none focus:border-[#203569] text-gray-800';
const label = 'block text-[13px] font-bold text-gray-700 mb-1.5';
const primary = 'bg-[#203569] text-white font-bold py-2.5 px-5 rounded-lg hover:bg-[#1a2b56] transition shadow-sm cursor-pointer disabled:opacity-60';

const STATUS_STYLE = {
    APPROVED: 'bg-[#dcfce7] text-[#15803d]',
    PENDING: 'bg-[#fefce8] text-[#a16207]',
    REJECTED: 'bg-[#fee2e2] text-[#b91c1c]',
};

export function VerificationSection() {
    const { user, refresh } = useAuth();
    const [items, setItems] = useState(null);
    const [files, setFiles] = useState({});
    const [note, setNote] = useState('');
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);
    const [sending, setSending] = useState(false);
    const isStudent = user.role === 'STUDENT';
    const verified = isStudent ? user.studentVerified : user.landlordVerified;

    const load = () => api('/profile/verification').then(setItems).catch(setError);
    useEffect(() => { load(); }, []);

    const pick = (name) => (list) => setFiles({ ...files, [name]: list });

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        const all = Object.values(files).flat();
        const big = tooLarge(all);
        if (big) { setError({ message: `"${big.name}" is larger than ${MAX_DOCUMENT_MB} MB.` }); return; }
        const form = new FormData();
        Object.entries(files).forEach(([name, list]) => list.forEach((f) => form.append(name, f)));
        if (note.trim()) form.append('note', note.trim());
        setSending(true);
        try {
            await api('/profile/verification', { method: 'POST', form });
            setDone(true);
            setFiles({});
            setNote('');
            load();
            refresh();
        } catch (err) {
            setError(err);
        } finally {
            setSending(false);
        }
    };

    const latest = items?.[0];
    const pending = latest?.status === 'PENDING';
    const canSubmit = !verified && !pending && user.emailVerified;
    const reviewer = isStudent ? 'an administrator' : 'the legal reviewer';
    const ready = isStudent ? files.offerLetter?.length && files.studentCard?.length : files.identityCard?.length || files.companyRegistration?.length;

    return (
        <div id="verification">
            <h3 className={sectionTitle}>{isStudent ? 'UTS Student Verification' : 'Landlord Verification'}</h3>
            <div className="flex flex-wrap items-center gap-3 mb-3">
                <span className={`text-[12px] font-bold px-3 py-1.5 rounded ${verified ? STATUS_STYLE.APPROVED : STATUS_STYLE[latest?.status] || STATUS_STYLE.PENDING}`}>
                    {verified ? '✓ Verified' : pending ? 'Under review' : latest?.status === 'REJECTED' ? 'Not approved' : 'Documents needed'}
                </span>
                {!user.emailVerified && <span className="text-[12px] text-[#a16207] font-bold">Confirm your e-mail first — check your inbox for the link.</span>}
                {pending && <span className="text-[12px] text-gray-500">Your documents are with {reviewer}. You will be notified of the decision.</span>}
            </div>
            {latest?.decisionNote && !verified && latest.status === 'REJECTED' && (
                <p className="text-[13px] text-[#b91c1c] font-bold mb-3">Reason: {latest.decisionNote}</p>
            )}
            {latest?.documents?.length > 0 && (
                <div className="mb-4">
                    <p className="text-[12px] font-bold text-gray-500 mb-1.5">Your uploaded documents ({latest.status.toLowerCase()})</p>
                    <DocumentLinks documents={latest.documents} />
                </div>
            )}
            <SuccessBanner message={done && `Documents sent. ${isStudent ? 'An administrator' : 'The legal reviewer'} will review them soon.`} className="mb-3" />
            <ErrorBanner error={error} className="mb-3" />
            {canSubmit && (
                <form onSubmit={submit} className="space-y-4 border border-gray-200 rounded-xl p-5 bg-[#fafafa]">
                    <p className="text-[13px] text-gray-600">
                        {isStudent
                            ? 'Upload your university offer letter and a clear photo of your student card. Only administrators can see these files.'
                            : 'Upload your identity card (MyKad or passport). If you rent as a company, upload the company registration (SSM) instead. Only the legal reviewer and administrators can see these files.'}
                    </p>
                    {isStudent ? (
                        <>
                            <FileField id="offerLetter" label="Offer letter" hint="PDF only, up to 10 MB." accept="application/pdf" required files={files.offerLetter} onChange={pick('offerLetter')} error={error?.fields?.offerLetter} />
                            <FileField id="studentCard" label="Student card photo" hint="JPG, PNG or PDF, up to 10 MB. Front side (and back if needed)." accept="image/jpeg,image/png,application/pdf" multiple required files={files.studentCard} onChange={pick('studentCard')} error={error?.fields?.studentCard} />
                        </>
                    ) : (
                        <>
                            <FileField id="identityCard" label="Identity card (MyKad / passport)" hint="JPG, PNG or PDF, up to 10 MB. Front and back." accept="image/jpeg,image/png,application/pdf" multiple files={files.identityCard} onChange={pick('identityCard')} error={error?.fields?.identityCard} />
                            <FileField id="companyRegistration" label="Company registration (SSM) — only if you rent as a company" accept="image/jpeg,image/png,application/pdf" multiple files={files.companyRegistration} onChange={pick('companyRegistration')} />
                        </>
                    )}
                    <div>
                        <label htmlFor="vnote" className={label}>Note for the reviewer (optional)</label>
                        <textarea id="vnote" rows="2" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={input}
                            placeholder={isStudent ? 'e.g. intake, programme' : 'e.g. how many properties you manage'}></textarea>
                    </div>
                    <button type="submit" disabled={sending || !ready} className={primary}>{sending ? 'Uploading...' : 'Submit Documents'}</button>
                </form>
            )}
        </div>
    );
}

export function PasswordSection() {
    const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        setDone(false);
        if (form.newPassword !== form.confirm) return setError({ message: 'New passwords do not match.' });
        setBusy(true);
        try {
            await api('/auth/change-password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
            setDone(true);
            setForm({ currentPassword: '', newPassword: '', confirm: '' });
        } catch (err) {
            setError(err);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit}>
            <h3 className={sectionTitle}>Change Password</h3>
            <SuccessBanner message={done && 'Password changed. Other devices were signed out.'} className="mb-4" />
            <ErrorBanner error={error} className="mb-4" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                    <label htmlFor="cur" className={label}>Current Password</label>
                    <input id="cur" type="password" required autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} className={input} />
                </div>
                <div>
                    <label htmlFor="newpw" className={label}>New Password</label>
                    <input id="newpw" type="password" required minLength={8} autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} className={input} />
                    <FieldError error={error} name="newPassword" />
                </div>
                <div>
                    <label htmlFor="confpw" className={label}>Confirm New Password</label>
                    <input id="confpw" type="password" required autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} className={input} />
                </div>
            </div>
            <div className="flex justify-end mt-4">
                <button type="submit" disabled={busy} className={primary}>{busy ? 'Saving...' : 'Update Password'}</button>
            </div>
        </form>
    );
}

export function NotificationSettingsSection() {
    const { user, refresh } = useAuth();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const enabled = user?.emailNotifications !== false;

    const toggle = async () => {
        setSaving(true);
        setError(null);
        try {
            await api('/profile', { method: 'PATCH', body: { emailNotifications: !enabled } });
            await refresh();
        } catch (err) {
            setError(err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <h3 className={sectionTitle}>Notifications</h3>
            <ErrorBanner error={error} className="mb-3" />
            <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={enabled} disabled={saving} onChange={toggle} className="mt-1 w-4 h-4 accent-[#203569]" />
                <span>
                    <span className="block text-sm font-bold text-gray-800">E-mail me about important updates</span>
                    <span className="block text-[12px] text-gray-500 mt-0.5">
                        Listing approvals, new inquiries, roommate requests and availability reminders. In-app notifications and chat messages
                        always appear instantly. Security e-mails (verification, password reset) are always sent.
                    </span>
                </span>
            </label>
        </div>
    );
}

export function BlockedUsersSection() {
    const [items, setItems] = useState([]);
    const load = () => api('/blocks').then(setItems).catch(() => {});
    useEffect(() => { load(); }, []);
    const unblock = async (id) => {
        await api(`/blocks/${id}`, { method: 'DELETE' }).catch(() => {});
        load();
    };
    return (
        <div>
            <h3 className={sectionTitle}>Blocked Users</h3>
            {items.length === 0 ? <p className="text-sm text-gray-500">You haven't blocked anyone.</p> : (
                <div className="space-y-2">
                    {items.map((u) => (
                        <div key={u.id} className="flex justify-between items-center border border-gray-200 rounded-lg px-4 py-2.5">
                            <span className="text-sm font-bold text-gray-800">{u.name}</span>
                            <button onClick={() => unblock(u.id)} className="text-xs font-bold text-[#1d4ed8] hover:underline cursor-pointer">Unblock</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export function MyReviewsSection() {
    const [items, setItems] = useState(null);
    useEffect(() => { api('/reviews/mine').then(setItems).catch(() => setItems([])); }, []);
    return (
        <div>
            <h3 className={sectionTitle}>My Reviews</h3>
            {!items ? <p className="text-sm text-gray-400">Loading...</p> : items.length === 0 ? (
                <p className="text-sm text-gray-500">You haven't reviewed any property yet. Open a listing in Find Housing to write one.</p>
            ) : (
                <div className="space-y-3">
                    {items.map((r) => (
                        <div key={r.id} className="border border-gray-200 rounded-xl p-4">
                            <div className="flex flex-wrap justify-between items-center gap-2 mb-1">
                                <h4 className="font-bold text-[#203569] text-[14px]">{r.listing?.title}</h4>
                                <div className="flex items-center gap-2">
                                    <Stars value={r.rating} className="text-sm" />
                                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${STATUS_STYLE[r.moderationStatus]}`}>
                                        {r.moderationStatus === 'PENDING' ? 'Waiting for moderation' : r.moderationStatus === 'APPROVED' ? 'Published' : 'Not published'}
                                    </span>
                                </div>
                            </div>
                            <p className="text-[13px] text-gray-600">{r.body}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export function DeleteAccountSection() {
    const navigate = useNavigate();
    const { logout } = useAuth();
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        try {
            await api('/auth/delete-account', { method: 'POST', body: { password } });
            await logout();
            navigate('/', { replace: true });
        } catch (err) {
            setError(err);
        }
    };

    return (
        <div>
            <h3 className={sectionTitle}>Delete Account</h3>
            <p className="text-sm text-gray-500 mb-3">
                Your roommate profile is hidden and your listings are paused immediately. An administrator permanently deletes the account afterwards. Logging in again before then cancels the request.
            </p>
            {!open ? (
                <button onClick={() => setOpen(true)} className="border border-red-200 text-red-600 text-sm font-bold px-4 py-2 rounded-lg bg-white hover:bg-red-50 transition cursor-pointer">Request Account Deletion</button>
            ) : (
                <form onSubmit={submit} className="space-y-3 max-w-sm">
                    <ErrorBanner error={error} />
                    <label htmlFor="delpw" className={label}>Confirm with your password</label>
                    <input id="delpw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
                    <div className="flex gap-3">
                        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-gray-600 font-bold text-sm hover:bg-gray-100 rounded-lg cursor-pointer">Cancel</button>
                        <button type="submit" className="bg-red-600 text-white font-bold text-sm px-4 py-2 rounded-lg hover:bg-red-700 transition cursor-pointer">Delete My Account</button>
                    </div>
                </form>
            )}
        </div>
    );
}
