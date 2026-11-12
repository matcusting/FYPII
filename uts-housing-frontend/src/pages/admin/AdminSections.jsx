import { useCallback, useEffect, useState } from 'react';
import { api, assetUrl, statusLabel, timeAgo } from '../../lib/api';
import { ErrorBanner, LoadingBlock, Stars, SuccessBanner } from '../../components/ui';

/* ------------------------------------------------------------ shared bits */

const Page = ({ title, right, children }) => (
    <div className="p-5 sm:p-10 overflow-y-auto animate-fade-in-up">
        <div className="flex flex-wrap gap-3 justify-between items-center border-b border-gray-100 pb-4 mb-6">
            <h2 className="text-[1.4rem] font-bold text-[#0f172a]">{title}</h2>
            {right}
        </div>
        {children}
    </div>
);

const StatusFilter = ({ value, onChange, options }) => (
    <select aria-label="Filter by status" value={value} onChange={(e) => onChange(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-[#203569] text-gray-800 bg-white cursor-pointer">
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
);

const Card = ({ children }) => <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm">{children}</div>;
const Empty = ({ text }) => <p className="text-sm text-gray-400 font-bold py-10 text-center">{text}</p>;
const Pill = ({ className, children }) => <span className={`text-[11px] font-bold px-2.5 py-1 rounded ${className}`}>{children}</span>;

/** Approve button + "reject with reason" inline form. */
function Decision({ onApprove, onReject, approveLabel = 'Approve', rejectLabel = 'Reject', extra }) {
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const wrap = (fn) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
    if (rejecting) {
        return (
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
                <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason shown to the user..." aria-label="Reason" maxLength={500} className="flex-1 text-sm p-2 border border-gray-300 rounded-lg outline-none focus:border-[#203569]" />
                <button disabled={busy || !reason.trim()} onClick={wrap(() => onReject(reason))} className="bg-[#e11d48] text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-red-700 cursor-pointer disabled:opacity-50">{rejectLabel}</button>
                <button onClick={() => setRejecting(false)} className="text-gray-500 text-xs font-bold px-3 py-2 hover:bg-gray-100 rounded-lg cursor-pointer">Cancel</button>
            </div>
        );
    }
    return (
        <div className="flex flex-wrap gap-3 mt-4">
            {onApprove && <button disabled={busy} onClick={wrap(onApprove)} className="bg-[#15803d] text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-green-800 transition cursor-pointer disabled:opacity-50">✓ {approveLabel}</button>}
            {onReject && <button disabled={busy} onClick={() => setRejecting(true)} className="border border-red-200 text-red-600 text-xs font-bold px-4 py-2 rounded-lg bg-white hover:bg-red-50 transition cursor-pointer">✖ {rejectLabel}</button>}
            {extra}
        </div>
    );
}

function useQueue(path, initialStatus) {
    const [status, setStatus] = useState(initialStatus);
    const [items, setItems] = useState(null);
    const [error, setError] = useState(null);
    const load = useCallback(
        () => api(path, { query: { status } }).then((rows) => { setItems(rows); setError(null); }).catch(setError),
        [path, status],
    );
    useEffect(() => { load(); }, [load]);
    return { status, setStatus, items, error, setError, load };
}

/* ---------------------------------------------------------------- overview */

export function Overview({ data, go }) {
    if (!data) return <Page title="Admin Overview"><LoadingBlock /></Page>;
    const cards = [
        ['verifications', data.pendingVerifications, 'Pending Verifications', 'bg-[#eff6ff] border-[#bfdbfe] text-[#1d4ed8]'],
        ['listings', data.pendingListings, 'Listings to Approve', 'bg-[#f0fdf4] border-[#bbf7d0] text-[#15803d]'],
        ['reviews', data.pendingReviews, 'Reviews to Moderate', 'bg-[#fefce8] border-[#fef08a] text-[#a16207]'],
        ['reports', data.openReports, 'Open Reports', 'bg-[#fff1f2] border-[#fecdd3] text-[#be123c]'],
    ];
    return (
        <Page title="Admin Overview">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
                {cards.map(([tab, n, label, cls]) => (
                    <div key={tab} onClick={() => go(tab)} className={`rounded-xl p-6 border cursor-pointer hover:shadow-md transition ${cls}`}>
                        <div className="text-4xl font-bold mb-2">{n}</div>
                        <div className="text-sm font-bold">{label} →</div>
                    </div>
                ))}
            </div>
            {data.deletionRequests > 0 && (
                <p onClick={() => go('users')} className="bg-[#fee2e2] border border-[#fecaca] text-[#b91c1c] text-[13px] font-bold px-4 py-3 rounded-lg cursor-pointer mb-8">
                    🗑 {data.deletionRequests} account deletion request(s) waiting.
                </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <Card>
                    <h3 className="font-bold text-[#0f172a] mb-3">Users</h3>
                    {['STUDENT', 'LANDLORD', 'ADMIN'].map((r) => (
                        <div key={r} className="flex justify-between text-sm py-1.5 border-b border-gray-50"><span className="text-gray-600 capitalize">{r.toLowerCase()}s</span><strong>{data.users[r] || 0}</strong></div>
                    ))}
                </Card>
                <Card>
                    <h3 className="font-bold text-[#0f172a] mb-3">Listings by status</h3>
                    {Object.entries(data.listings).map(([s, n]) => (
                        <div key={s} className="flex justify-between text-sm py-1.5 border-b border-gray-50"><span className="text-gray-600">{statusLabel(s)}</span><strong>{n}</strong></div>
                    ))}
                </Card>
            </div>
            <h3 className="text-[1.1rem] font-bold text-[#0f172a] mb-3">Recent Admin Actions</h3>
            {data.recentActions.length === 0 ? <p className="text-sm text-gray-400 font-bold">No actions yet.</p> : data.recentActions.map((a) => (
                <div key={a.id} className="flex justify-between py-3 border-b border-gray-100 text-sm">
                    <span className="text-gray-600"><strong className="text-gray-900">{a.actor}</strong> — {a.action.replaceAll('_', ' ').toLowerCase()}</span>
                    <span className="text-gray-400">{timeAgo(a.createdAt)}</span>
                </div>
            ))}
        </Page>
    );
}

/* ----------------------------------------------------------- verifications */

export function VerificationQueue({ onChange }) {
    const q = useQueue('/admin/verifications', 'PENDING');
    const decide = async (id, decision, note) => {
        try {
            await api(`/admin/verifications/${id}`, { method: 'PATCH', body: { decision, note } });
            await q.load();
            onChange();
        } catch (err) { q.setError(err); }
    };
    return (
        <Page title="Identity Verifications" right={<StatusFilter value={q.status} onChange={q.setStatus} options={[['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['ALL', 'All']]} />}>
            <ErrorBanner error={q.error} className="mb-4" />
            {!q.items ? <LoadingBlock /> : q.items.length === 0 ? <Empty text="Nothing to review. 🎉" /> : (
                <div className="space-y-4">
                    {q.items.map((v) => (
                        <Card key={v.id}>
                            <div className="flex flex-wrap justify-between gap-2">
                                <div>
                                    <h3 className="font-bold text-[#0f172a]">{v.user.name} <Pill className={v.type === 'STUDENT' ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'bg-[#f3e8ff] text-[#7e22ce]'}>{v.type}</Pill></h3>
                                    <p className="text-[13px] text-gray-500 mt-1">
                                        {v.user.email} {v.user.emailVerified ? '(e-mail confirmed)' : '(e-mail NOT confirmed)'}
                                        {v.user.studentId && <> • Student ID: <strong>{v.user.studentId}</strong></>}
                                        {v.user.phone && <> • {v.user.phone}</>}
                                    </p>
                                    <p className="text-[12px] text-gray-400 mt-1">Method: {v.method === 'EMAIL_DOMAIN' ? 'University e-mail domain' : 'Manual review'} • Submitted {timeAgo(v.createdAt)}</p>
                                </div>
                                <Pill className={v.status === 'APPROVED' ? 'bg-[#dcfce7] text-[#15803d]' : v.status === 'REJECTED' ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#fefce8] text-[#a16207]'}>{v.status}</Pill>
                            </div>
                            {v.note && <p className="text-[13px] text-gray-700 bg-[#f8f9fa] border-l-4 border-[#203569] p-3 rounded-r-lg mt-3">"{v.note}"</p>}
                            {v.decisionNote && <p className="text-[12px] text-gray-500 mt-2">Decision note: {v.decisionNote} {v.reviewedBy && `— ${v.reviewedBy}`}</p>}
                            {v.status === 'PENDING' && (
                                <Decision onApprove={() => decide(v.id, 'APPROVED')} onReject={(note) => decide(v.id, 'REJECTED', note)} />
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </Page>
    );
}

/* ---------------------------------------------------------------- listings */

export function ListingQueue({ onChange }) {
    const q = useQueue('/admin/listings', 'PENDING_REVIEW');
    const [open, setOpen] = useState(null);
    const act = async (id, action, reason) => {
        try {
            await api(`/admin/listings/${id}`, { method: 'PATCH', body: { action, reason } });
            await q.load();
            onChange();
        } catch (err) { q.setError(err); }
    };
    return (
        <Page title="Listing Approval" right={<StatusFilter value={q.status} onChange={q.setStatus} options={[['PENDING_REVIEW', 'Pending Review'], ['PUBLISHED', 'Active'], ['REJECTED', 'Rejected'], ['PAUSED', 'Paused'], ['RENTED', 'Rented'], ['DRAFT', 'Draft'], ['ALL', 'All']]} />}>
            <ErrorBanner error={q.error} className="mb-4" />
            {!q.items ? <LoadingBlock /> : q.items.length === 0 ? <Empty text="No listings in this state." /> : (
                <div className="space-y-4">
                    {q.items.map((l) => (
                        <Card key={l.id}>
                            <div className="flex flex-col sm:flex-row gap-5">
                                {l.photos[0] ? <img src={assetUrl(l.photos[0].url)} alt={l.title} className="w-full sm:w-[140px] h-[100px] object-cover rounded-lg flex-shrink-0" /> : <div className="w-full sm:w-[140px] h-[100px] bg-[#e2e8f0] rounded-lg flex items-center justify-center text-gray-400 font-bold text-sm">No photo</div>}
                                <div className="flex-1">
                                    <div className="flex flex-wrap justify-between gap-2">
                                        <h3 className="font-bold text-[#1e3a8a] text-[1.05rem]">{l.title}</h3>
                                        <Pill className="bg-gray-100 text-gray-600">{statusLabel(l.status)}</Pill>
                                    </div>
                                    <p className="text-[13px] text-gray-500 mt-1">
                                        By <strong>{l.landlord.name}</strong> {l.landlord.verified ? '(verified)' : '(not verified)'} • RM {l.rent}/mo • Deposit RM {l.deposit} • {l.distanceKm} km • {l.roomType}
                                    </p>
                                    {l.rejectionReason && <p className="text-[12px] text-[#b91c1c] font-bold mt-1">{l.rejectionReason}</p>}
                                    <button onClick={() => setOpen(open === l.id ? null : l.id)} className="text-[12px] font-bold text-[#1d4ed8] hover:underline mt-2 cursor-pointer">{open === l.id ? 'Hide details' : 'View details'}</button>
                                </div>
                            </div>
                            {open === l.id && (
                                <div className="mt-4 border-t border-gray-100 pt-4 space-y-3 text-sm text-gray-600">
                                    <p className="whitespace-pre-line">{l.description || 'No description.'}</p>
                                    {l.houseRules && <p><strong>House rules:</strong> {l.houseRules}</p>}
                                    <p><strong>Area:</strong> {l.approximateArea || '—'} • <strong>Available:</strong> {l.availableFrom || 'now'} • <strong>Furnished:</strong> {l.furnished ? 'Yes' : 'No'}</p>
                                    <div className="flex flex-wrap gap-1.5">{l.facilities.map((f) => <span key={f} className="bg-gray-100 text-gray-600 text-[11px] font-bold px-2 py-0.5 rounded">{f}</span>)}</div>
                                    <div className="flex flex-wrap gap-2">{l.photos.map((p) => <img key={p.id} src={assetUrl(p.url)} alt="" className="w-24 h-16 object-cover rounded" />)}</div>
                                </div>
                            )}
                            {l.status === 'PENDING_REVIEW' && <Decision onApprove={() => act(l.id, 'approve')} onReject={(r) => act(l.id, 'reject', r)} />}
                            {l.status === 'PUBLISHED' && <Decision onReject={(r) => act(l.id, 'suspend', r)} rejectLabel="Suspend Listing" />}
                        </Card>
                    ))}
                </div>
            )}
        </Page>
    );
}

/* ----------------------------------------------------------------- reviews */

export function ReviewQueue({ onChange }) {
    const q = useQueue('/admin/reviews', 'PENDING');
    const decide = async (id, decision, note) => {
        try {
            await api(`/admin/reviews/${id}`, { method: 'PATCH', body: { decision, note } });
            await q.load();
            onChange();
        } catch (err) { q.setError(err); }
    };
    return (
        <Page title="Review Moderation" right={<StatusFilter value={q.status} onChange={q.setStatus} options={[['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['ALL', 'All']]} />}>
            <ErrorBanner error={q.error} className="mb-4" />
            {!q.items ? <LoadingBlock /> : q.items.length === 0 ? <Empty text="No reviews waiting." /> : (
                <div className="space-y-4">
                    {q.items.map((r) => (
                        <Card key={r.id}>
                            <div className="flex flex-wrap justify-between gap-2 mb-2">
                                <div>
                                    <h3 className="font-bold text-[#0f172a]">{r.author.name} → "{r.listing.title}"</h3>
                                    <p className="text-[12px] text-gray-500">Landlord: {r.landlord.name} • Stayed {r.stayFrom}{r.stayTo ? ` – ${r.stayTo}` : ' – present'} • {timeAgo(r.createdAt)} {r.edited && '• edited'}</p>
                                </div>
                                <Stars value={r.rating} />
                            </div>
                            <p className="text-[14px] text-gray-700 leading-relaxed">{r.body}</p>
                            <div className="bg-[#fefce8] border border-[#fef08a] rounded-lg p-3 mt-3 text-[13px] text-[#713f12]">
                                <strong>Proof of stay (private):</strong> {r.proofNote}
                                <br />
                                <span className="text-[12px]">{r.hadInquiry ? '✓ Student contacted this landlord about the listing through the platform.' : 'No in-app conversation with the landlord about this listing.'}</span>
                            </div>
                            {r.moderationNote && <p className="text-[12px] text-gray-500 mt-2">Moderation note: {r.moderationNote}</p>}
                            {r.moderationStatus === 'PENDING' && <Decision onApprove={() => decide(r.id, 'APPROVED')} onReject={(n) => decide(r.id, 'REJECTED', n)} approveLabel="Publish" />}
                            {r.moderationStatus === 'APPROVED' && <Decision onReject={(n) => decide(r.id, 'REJECTED', n)} rejectLabel="Unpublish" />}
                        </Card>
                    ))}
                </div>
            )}
        </Page>
    );
}

/* ----------------------------------------------------------------- reports */

export function ReportQueue({ onChange }) {
    const q = useQueue('/admin/reports', 'OPEN');
    const [notice, setNotice] = useState(null);
    const resolve = async (id, status, resolution) => {
        try {
            await api(`/admin/reports/${id}`, { method: 'PATCH', body: { status, resolution } });
            await q.load();
            onChange();
        } catch (err) { q.setError(err); }
    };
    const quick = async (r) => {
        const reason = window.prompt(`Reason for suspending this ${r.targetType.toLowerCase()}:`);
        if (!reason) return;
        try {
            if (r.targetType === 'LISTING') await api(`/admin/listings/${r.targetId}`, { method: 'PATCH', body: { action: 'suspend', reason } });
            else if (r.targetType === 'REVIEW') await api(`/admin/reviews/${r.targetId}`, { method: 'PATCH', body: { decision: 'REJECTED', note: reason } });
            else await api(`/admin/users/${r.target.ownerId}`, { method: 'PATCH', body: { status: 'SUSPENDED', reason } });
            setNotice('Action applied. Remember to resolve the report.');
            q.load();
        } catch (err) { q.setError(err); }
    };
    return (
        <Page title="Abuse Reports" right={<StatusFilter value={q.status} onChange={q.setStatus} options={[['OPEN', 'Open'], ['RESOLVED', 'Resolved'], ['DISMISSED', 'Dismissed'], ['ALL', 'All']]} />}>
            <ErrorBanner error={q.error} className="mb-4" />
            <SuccessBanner message={notice} className="mb-4" />
            {!q.items ? <LoadingBlock /> : q.items.length === 0 ? <Empty text="No reports. 🎉" /> : (
                <div className="space-y-4">
                    {q.items.map((r) => (
                        <Card key={r.id}>
                            <div className="flex flex-wrap justify-between gap-2">
                                <h3 className="font-bold text-[#0f172a]"><Pill className="bg-[#fff1f2] text-[#be123c]">{r.targetType}</Pill> {r.reason}</h3>
                                <span className="text-[12px] text-gray-400">by {r.reporter} • {timeAgo(r.createdAt)}</span>
                            </div>
                            <p className="text-[13px] text-gray-700 bg-[#f8f9fa] border-l-4 border-[#e11d48] p-3 rounded-r-lg mt-3">
                                {r.target ? r.target.label : 'This item has been deleted.'}
                                {r.target?.owner && <span className="block text-[12px] text-gray-500 mt-1">Owner: {r.target.owner}</span>}
                            </p>
                            {r.details && <p className="text-[13px] text-gray-600 mt-2">Reporter's details: {r.details}</p>}
                            {r.resolution && <p className="text-[12px] text-gray-500 mt-2">Resolution: {r.resolution} {r.resolvedBy && `— ${r.resolvedBy}`}</p>}
                            {r.status === 'OPEN' && (
                                <Decision
                                    approveLabel="Resolve"
                                    rejectLabel="Dismiss"
                                    onApprove={async () => { const t = window.prompt('Describe what you did to resolve this report:'); if (t) await resolve(r.id, 'RESOLVED', t); }}
                                    onReject={(t) => resolve(r.id, 'DISMISSED', t)}
                                    extra={r.target && r.targetType !== 'MESSAGE' ? (
                                        <button onClick={() => quick(r)} className="border border-gray-300 text-gray-700 text-xs font-bold px-4 py-2 rounded-lg bg-white hover:bg-gray-50 transition cursor-pointer">
                                            {r.targetType === 'LISTING' ? 'Suspend listing' : r.targetType === 'REVIEW' ? 'Unpublish review' : 'Suspend user'}
                                        </button>
                                    ) : r.target ? (
                                        <button onClick={() => quick(r)} className="border border-gray-300 text-gray-700 text-xs font-bold px-4 py-2 rounded-lg bg-white hover:bg-gray-50 transition cursor-pointer">Suspend sender</button>
                                    ) : null}
                                />
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </Page>
    );
}

/* ------------------------------------------------------------------- users */

export function Users({ onChange, currentUserId }) {
    const [role, setRole] = useState('');
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [items, setItems] = useState(null);
    const [error, setError] = useState(null);

    const load = useCallback(() => {
        api('/admin/users', { query: { role, status, q: search.trim() } }).then(setItems).catch(setError);
    }, [role, status, search]);
    useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

    const setUserStatus = async (u, next) => {
        const reason = next === 'SUSPENDED' ? window.prompt(`Reason for suspending ${u.name}:`) : 'Reactivated';
        if (next === 'SUSPENDED' && !reason) return;
        try {
            await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: next, reason } });
            load();
            onChange();
        } catch (err) { setError(err); }
    };
    const remove = async (u) => {
        if (!window.confirm(`Permanently delete ${u.name} (${u.email}) and all their data? This cannot be undone.`)) return;
        try {
            await api(`/admin/users/${u.id}`, { method: 'DELETE' });
            load();
            onChange();
        } catch (err) { setError(err); }
    };

    const statusPill = (s) => ({ ACTIVE: 'bg-[#dcfce7] text-[#15803d]', SUSPENDED: 'bg-[#fee2e2] text-[#b91c1c]', DELETION_REQUESTED: 'bg-[#fefce8] text-[#a16207]' }[s]);

    return (
        <Page
            title="Users"
            right={
                <div className="flex flex-wrap gap-2">
                    <input type="search" aria-label="Search users" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, e-mail or Student ID" className="p-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-[#203569]" />
                    <StatusFilter value={role} onChange={setRole} options={[['', 'All roles'], ['STUDENT', 'Students'], ['LANDLORD', 'Landlords'], ['ADMIN', 'Admins']]} />
                    <StatusFilter value={status} onChange={setStatus} options={[['', 'Any status'], ['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended'], ['DELETION_REQUESTED', 'Deletion requested']]} />
                </div>
            }
        >
            <ErrorBanner error={error} className="mb-4" />
            {!items ? <LoadingBlock /> : items.length === 0 ? <Empty text="No users found." /> : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-200">
                                <th className="py-3 pr-3">Name</th><th className="py-3 pr-3">Role</th><th className="py-3 pr-3">Verified</th><th className="py-3 pr-3">Status</th><th className="py-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((u) => (
                                <tr key={u.id} className="border-b border-gray-100 align-top">
                                    <td className="py-3 pr-3"><strong className="text-gray-900">{u.name}</strong><br /><span className="text-gray-500 text-[12px]">{u.email}{u.studentId && ` • ${u.studentId}`}</span></td>
                                    <td className="py-3 pr-3 text-gray-600 capitalize">{u.role.toLowerCase()}</td>
                                    <td className="py-3 pr-3">{u.role === 'ADMIN' ? '—' : (u.role === 'STUDENT' ? u.studentVerified : u.landlordVerified) ? '✓' : <span className="text-[#a16207] font-bold">Pending</span>}</td>
                                    <td className="py-3 pr-3"><Pill className={statusPill(u.status)}>{u.status.replace('_', ' ')}</Pill></td>
                                    <td className="py-3 whitespace-nowrap">
                                        {u.role !== 'ADMIN' && u.id !== currentUserId && (
                                            <div className="flex gap-2">
                                                {u.status === 'SUSPENDED'
                                                    ? <button onClick={() => setUserStatus(u, 'ACTIVE')} className="text-[12px] font-bold text-[#15803d] hover:underline cursor-pointer">Reactivate</button>
                                                    : <button onClick={() => setUserStatus(u, 'SUSPENDED')} className="text-[12px] font-bold text-[#a16207] hover:underline cursor-pointer">Suspend</button>}
                                                <button onClick={() => remove(u)} className="text-[12px] font-bold text-[#b91c1c] hover:underline cursor-pointer">Delete</button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Page>
    );
}

/* ---------------------------------------------------------------- campuses */

export function Campuses() {
    const [unis, setUnis] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [domains, setDomains] = useState({});
    const [campusEdits, setCampusEdits] = useState({});
    const [newCampus, setNewCampus] = useState({ name: '', latitude: '', longitude: '' });
    const [newAmenity, setNewAmenity] = useState('');

    const load = useCallback(() => api('/admin/universities').then((list) => {
        setUnis(list);
        setDomains(Object.fromEntries(list.map((u) => [u.id, u.emailDomains.join(', ')])));
        setCampusEdits(Object.fromEntries(list.flatMap((u) => u.campuses.map((c) => [c.id, { ...c }]))));
    }).catch(setError), []);
    useEffect(() => { load(); }, [load]);

    const wrap = (fn, msg) => async (e) => {
        e?.preventDefault();
        setError(null);
        setNotice(null);
        try { await fn(); setNotice(msg); load(); } catch (err) { setError(err); }
    };

    const input = 'p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800 text-sm';

    return (
        <Page title="Campus & Verification Domains">
            <ErrorBanner error={error} className="mb-4" />
            <SuccessBanner message={notice} className="mb-4" />
            {!unis ? <LoadingBlock /> : unis.map((u) => (
                <Card key={u.id}>
                    <h3 className="font-bold text-[#0f172a] mb-4">{u.name}</h3>
                    <form onSubmit={wrap(() => api(`/admin/universities/${u.id}`, { method: 'PATCH', body: { emailDomains: domains[u.id].split(',').map((d) => d.trim()).filter(Boolean) } }), 'E-mail domains saved.')} className="mb-6">
                        <label htmlFor={`dom-${u.id}`} className="block text-[13px] font-bold text-[#374151] mb-1.5">Student e-mail domains (auto-verified, comma separated)</label>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input id={`dom-${u.id}`} value={domains[u.id] || ''} onChange={(e) => setDomains({ ...domains, [u.id]: e.target.value })} className={`flex-1 ${input}`} />
                            <button className="bg-[#203569] text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-[#1a2b56] cursor-pointer">Save Domains</button>
                        </div>
                    </form>

                    <p className="text-[13px] font-bold text-[#374151] mb-2">Campuses (coordinates used for distance reference)</p>
                    <div className="space-y-2 mb-4">
                        {u.campuses.map((c) => {
                            const ed = campusEdits[c.id] || c;
                            return (
                                <form key={c.id} onSubmit={wrap(() => api(`/admin/campuses/${c.id}`, { method: 'PATCH', body: { name: ed.name, latitude: ed.latitude, longitude: ed.longitude } }), 'Campus saved.')} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px_auto] gap-2">
                                    <input aria-label="Campus name" value={ed.name} onChange={(e) => setCampusEdits({ ...campusEdits, [c.id]: { ...ed, name: e.target.value } })} className={input} />
                                    <input aria-label="Latitude" type="number" step="0.000001" value={ed.latitude} onChange={(e) => setCampusEdits({ ...campusEdits, [c.id]: { ...ed, latitude: e.target.value } })} className={input} />
                                    <input aria-label="Longitude" type="number" step="0.000001" value={ed.longitude} onChange={(e) => setCampusEdits({ ...campusEdits, [c.id]: { ...ed, longitude: e.target.value } })} className={input} />
                                    <button className="border border-gray-300 text-gray-700 text-xs font-bold px-4 py-2 rounded-lg bg-white hover:bg-gray-50 cursor-pointer">Save</button>
                                </form>
                            );
                        })}
                    </div>
                    <form onSubmit={wrap(async () => { await api('/admin/campuses', { method: 'POST', body: { universityId: u.id, ...newCampus } }); setNewCampus({ name: '', latitude: '', longitude: '' }); }, 'Campus added.')} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px_auto] gap-2">
                        <input aria-label="New campus name" required placeholder="New campus name" value={newCampus.name} onChange={(e) => setNewCampus({ ...newCampus, name: e.target.value })} className={input} />
                        <input aria-label="New campus latitude" required type="number" step="0.000001" placeholder="Latitude" value={newCampus.latitude} onChange={(e) => setNewCampus({ ...newCampus, latitude: e.target.value })} className={input} />
                        <input aria-label="New campus longitude" required type="number" step="0.000001" placeholder="Longitude" value={newCampus.longitude} onChange={(e) => setNewCampus({ ...newCampus, longitude: e.target.value })} className={input} />
                        <button className="bg-[#15803d] text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-green-800 cursor-pointer">+ Add Campus</button>
                    </form>
                </Card>
            ))}

            <div className="mt-6">
                <Card>
                    <h3 className="font-bold text-[#0f172a] mb-3">Add a Facility Option</h3>
                    <form onSubmit={wrap(async () => { await api('/admin/amenities', { method: 'POST', body: { name: newAmenity } }); setNewAmenity(''); }, 'Facility added.')} className="flex flex-col sm:flex-row gap-2">
                        <input aria-label="Facility name" required value={newAmenity} onChange={(e) => setNewAmenity(e.target.value)} placeholder="e.g. Swimming Pool" className={`flex-1 ${input}`} />
                        <button className="bg-[#203569] text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-[#1a2b56] cursor-pointer">Add Facility</button>
                    </form>
                </Card>
            </div>
        </Page>
    );
}

/* --------------------------------------------------------------- audit log */

export function AuditLog() {
    const [items, setItems] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => { api('/admin/audit-logs').then(setItems).catch(setError); }, []);
    return (
        <Page title="Audit Log">
            <ErrorBanner error={error} className="mb-4" />
            {!items ? <LoadingBlock /> : items.length === 0 ? <Empty text="No admin actions recorded yet." /> : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-200">
                                <th className="py-3 pr-3">When</th><th className="py-3 pr-3">Admin</th><th className="py-3 pr-3">Action</th><th className="py-3">Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((a) => (
                                <tr key={a.id} className="border-b border-gray-100 align-top">
                                    <td className="py-3 pr-3 text-gray-500 whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</td>
                                    <td className="py-3 pr-3 font-bold text-gray-800">{a.actor}</td>
                                    <td className="py-3 pr-3 text-gray-700">{a.action.replaceAll('_', ' ')}<br /><span className="text-[11px] text-gray-400">{a.targetType} {a.targetId?.slice(0, 8)}</span></td>
                                    <td className="py-3 text-[12px] text-gray-500 break-all">{a.details ? Object.entries(a.details).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' • ') : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Page>
    );
}
