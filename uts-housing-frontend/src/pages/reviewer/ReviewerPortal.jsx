import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LEGAL_STATUS, api, statusLabel, timeAgo } from '../../lib/api';
import NotificationBell from '../../components/NotificationBell';
import { DocumentLinks } from '../../components/Documents';
import { ErrorBanner, LoadingBlock } from '../../components/ui';
import { Card, Decision, Empty, Page, Pill, StatusFilter } from '../admin/AdminSections';

const STATUS_OPTIONS = [['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['ALL', 'All']];
const statusPill = (s) => (s === 'APPROVED' ? 'bg-[#dcfce7] text-[#15803d]' : s === 'REJECTED' ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#fefce8] text-[#a16207]');

function useReviewQueue(path) {
    const [status, setStatus] = useState('PENDING');
    const [items, setItems] = useState(null);
    const [error, setError] = useState(null);
    const load = useCallback(() => api(path, { query: { status } }).then((r) => { setItems(r); setError(null); }).catch(setError), [path, status]);
    useEffect(() => { load(); }, [load]);
    return { status, setStatus, items, error, setError, load };
}

function LandlordQueue({ onChange }) {
    const q = useReviewQueue('/reviewer/landlords');
    const decide = async (id, decision, note) => {
        try {
            await api(`/reviewer/landlords/${id}`, { method: 'PATCH', body: { decision, note } });
            await q.load();
            onChange();
        } catch (err) { q.setError(err); }
    };
    return (
        <Page title="Landlord Identity" right={<StatusFilter value={q.status} onChange={q.setStatus} options={STATUS_OPTIONS} />}>
            <p className="text-[12px] text-gray-500 mb-4">Each landlord is verified once. Check that the identity document is genuine and matches the account name.</p>
            <ErrorBanner error={q.error} className="mb-4" />
            {!q.items ? <LoadingBlock /> : q.items.length === 0 ? <Empty text="No landlord documents to review. 🎉" /> : (
                <div className="space-y-4">
                    {q.items.map((v) => (
                        <Card key={v.id}>
                            <div className="flex flex-wrap justify-between gap-2">
                                <div>
                                    <h3 className="font-bold text-[#0f172a]">{v.landlord.name}</h3>
                                    <p className="text-[13px] text-gray-500 mt-1">{v.landlord.email}{v.landlord.phone && <> • {v.landlord.phone}</>}</p>
                                    <p className="text-[12px] text-gray-400 mt-1">Submitted {timeAgo(v.createdAt)}</p>
                                </div>
                                <Pill className={statusPill(v.status)}>{v.status}</Pill>
                            </div>
                            {v.note && <p className="text-[13px] text-gray-700 bg-[#f8f9fa] border-l-4 border-[#203569] p-3 rounded-r-lg mt-3">"{v.note}"</p>}
                            <div className="mt-3"><DocumentLinks documents={v.documents} /></div>
                            {v.decisionNote && <p className="text-[12px] text-gray-500 mt-2">Decision note: {v.decisionNote} {v.reviewedBy && `— ${v.reviewedBy}`}</p>}
                            {v.status === 'PENDING' && (
                                <Decision approveLabel="Verify Landlord" onApprove={() => decide(v.id, 'APPROVED')} onReject={(note) => decide(v.id, 'REJECTED', note)} />
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </Page>
    );
}

function PropertyQueue({ onChange }) {
    const q = useReviewQueue('/reviewer/properties');
    const decide = async (id, decision, note) => {
        try {
            await api(`/reviewer/properties/${id}`, { method: 'PATCH', body: { decision, note } });
            await q.load();
            onChange();
        } catch (err) { q.setError(err); }
    };
    return (
        <Page title="Property Documents" right={<StatusFilter value={q.status} onChange={q.setStatus} options={STATUS_OPTIONS} />}>
            <p className="text-[12px] text-gray-500 mb-4">
                Every property needs this check before an administrator can publish it. Confirm the landlord owns the property at this address, or has the right to rent it out (tenancy agreement and owner's authorisation).
            </p>
            <ErrorBanner error={q.error} className="mb-4" />
            {!q.items ? <LoadingBlock /> : q.items.length === 0 ? <Empty text="No property documents to review. 🎉" /> : (
                <div className="space-y-4">
                    {q.items.map((p) => (
                        <Card key={p.id}>
                            <div className="flex flex-wrap justify-between gap-2">
                                <div>
                                    <h3 className="font-bold text-[#1e3a8a] text-[1.05rem]">{p.title}</h3>
                                    <p className="text-[13px] text-gray-700 mt-1">📍 <strong>{p.address || '—'}</strong>{p.approximateArea && <span className="text-gray-500"> ({p.approximateArea})</span>}</p>
                                    <p className="text-[13px] text-gray-500 mt-1">
                                        {p.ownerRole === 'STUDENT' ? 'Student sublet by' : 'Landlord:'} <strong>{p.landlord.name}</strong> {p.ownerRole !== 'STUDENT' && (p.landlord.verified ? '(identity verified)' : '(identity NOT verified)')} • {p.landlord.email}
                                    </p>
                                    <p className="text-[12px] text-gray-400 mt-1">{p.roomType} • RM {p.rent}/mo • Listing status: {statusLabel(p.status)} • Updated {timeAgo(p.updatedAt)}</p>
                                </div>
                                <Pill className={LEGAL_STATUS[p.legalStatus].className}>{LEGAL_STATUS[p.legalStatus].label}</Pill>
                            </div>
                            <div className="mt-3"><DocumentLinks documents={p.documents} /></div>
                            {p.legalNote && <p className="text-[12px] text-gray-500 mt-2">Note: {p.legalNote} {p.legalReviewedBy && `— ${p.legalReviewedBy}`}</p>}
                            {p.legalStatus === 'PENDING' && (
                                <Decision approveLabel="Documents OK" rejectLabel="Not Accepted" onApprove={() => decide(p.id, 'APPROVED')} onReject={(note) => decide(p.id, 'REJECTED', note)} />
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </Page>
    );
}

const TABS = [
    ['properties', '🏠', 'Property Documents', 'pendingProperties'],
    ['landlords', '🪪', 'Landlord Identity', 'pendingLandlords'],
];

const ReviewerPortal = () => {
    const navigate = useNavigate();
    const { tab = 'properties' } = useParams();
    const { user, logout } = useAuth();
    const [overview, setOverview] = useState(null);
    const loadOverview = useCallback(() => api('/reviewer/overview').then(setOverview).catch(() => {}), []);
    useEffect(() => { loadOverview(); }, [loadOverview, tab]);

    const tabClass = (name) =>
        tab === name
            ? 'flex items-center gap-3 bg-[#ede9fe] text-[#6d28d9] font-bold px-4 py-3 rounded-lg cursor-pointer whitespace-nowrap'
            : 'flex items-center gap-3 text-gray-600 font-bold px-4 py-3 hover:bg-gray-100 rounded-lg cursor-pointer whitespace-nowrap';

    return (
        <div className="min-h-screen bg-[#f3f4f6] p-3 sm:p-8 font-sans">
            <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.05)] border border-gray-200 overflow-hidden flex flex-col">
                <div className="bg-[#1e1b4b] px-5 sm:px-8 py-5 flex flex-wrap gap-3 justify-between items-center">
                    <h1 className="text-white text-xl font-bold tracking-wide">UTS Housing Legal Review</h1>
                    <div className="flex items-center gap-4">
                        <span className="bg-[#7c3aed] text-white text-[11px] font-bold px-3 py-1 rounded">Legal Reviewer</span>
                        <NotificationBell dark />
                        <span className="text-white font-bold text-sm">{user.name}</span>
                        <button onClick={async () => { await logout(); navigate('/'); }} className="text-gray-400 hover:text-white text-sm ml-2 font-bold cursor-pointer">Logout</button>
                    </div>
                </div>
                <div className="flex flex-col md:flex-row flex-1 md:min-h-[640px]">
                    <div className="w-full md:w-[260px] bg-[#f8f9fa] border-b md:border-b-0 md:border-r border-gray-200 p-3 md:p-6 flex md:flex-col gap-1 overflow-x-auto flex-shrink-0" role="tablist">
                        {TABS.map(([name, icon, label, key]) => (
                            <div key={name} role="tab" tabIndex={0} aria-selected={tab === name} onClick={() => navigate(`/reviewer/${name}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/reviewer/${name}`); }} className={tabClass(name)}>
                                <span className="text-lg">{icon}</span> {label}
                                {overview?.[key] > 0 && <span className="ml-auto bg-[#e11d48] text-white text-[10px] px-2 py-0.5 rounded-full">{overview[key]}</span>}
                            </div>
                        ))}
                        <p className="hidden md:block text-[11px] text-gray-400 mt-6 leading-relaxed">
                            Documents are confidential. Every document you open is recorded in the audit log. Do not download or share them outside this review.
                        </p>
                    </div>
                    <div className="flex-1 bg-white overflow-hidden flex flex-col">
                        {tab === 'landlords' ? <LandlordQueue onChange={loadOverview} /> : <PropertyQueue onChange={loadOverview} />}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReviewerPortal;
