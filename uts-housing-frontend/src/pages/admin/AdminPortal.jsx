import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { useConversations } from '../../hooks/useConversations';
import NotificationBell from '../../components/NotificationBell';
import Messages from '../landlord/Messages';
import { AuditLog, Campuses, ListingQueue, Overview, ReportQueue, ReviewQueue, Reviewers, Users, VerificationQueue } from './AdminSections';
import { useT } from '../../i18n';
import LanguageSwitcher from '../../components/LanguageSwitcher';

const TABS = [
    ['overview', '📊', 'Overview'],
    ['verifications', '🪪', 'Student Verifications', 'pendingVerifications'],
    ['listings', '🏠', 'Listing Approval', 'pendingListings'],
    ['reviews', '⭐', 'Review Moderation', 'pendingReviews'],
    ['reports', '🚩', 'Abuse Reports', 'openReports'],
    ['users', '👥', 'Users', 'deletionRequests'],
    ['reviewers', '⚖️', 'Legal Reviewers'],
    ['campuses', '🏫', 'Campus & Domains'],
    ['support', '💬', 'Support Messages'],
    ['audit', '📜', 'Audit Log'],
];

const AdminPortal = () => {
    const { t } = useT();
    const navigate = useNavigate();
    const { tab = 'overview' } = useParams();
    const { user, logout } = useAuth();
    const [overview, setOverview] = useState(null);
    const chat = useConversations({ filter: (c) => c.type === 'SUPPORT' });

    const loadOverview = useCallback(() => api('/admin/overview').then(setOverview).catch(() => {}), []);
    useEffect(() => { loadOverview(); }, [loadOverview, tab]);

    const supportUnread = chat.conversations.reduce((s, c) => s + c.unread, 0);
    const go = (name) => navigate(name === 'overview' ? '/admin' : `/admin/${name}`);

    const handleLogout = async () => {
        await logout();
        navigate('/');
    };

    const getTabClass = (name) =>
        tab === name
            ? 'flex items-center gap-3 bg-[#e0e7ff] text-[#1d4ed8] font-bold px-4 py-3 rounded-lg cursor-pointer transition-colors whitespace-nowrap'
            : 'flex items-center gap-3 text-gray-600 font-bold px-4 py-3 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors whitespace-nowrap';

    return (
        <div className="min-h-screen bg-[#f3f4f6] p-3 sm:p-8 font-sans relative">
            <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.05)] border border-gray-200 overflow-hidden flex flex-col">

                {/* 顶部 Navbar */}
                <div className="bg-[#0f172a] px-5 sm:px-8 py-5 flex flex-wrap gap-3 justify-between items-center">
                    <h1 className="text-white text-xl font-bold tracking-wide">{t('UTS Housing Admin Console')}</h1>
                    <div className="flex flex-wrap items-center gap-4">
                        <span className="bg-[#6366f1] text-white text-[11px] font-bold px-3 py-1 rounded">{t('Administrator')}</span>
                        <LanguageSwitcher dark />
                        <NotificationBell dark />
                        <span className="text-white font-bold text-sm">{user.name}</span>
                        <button onClick={handleLogout} className="text-gray-400 hover:text-white text-sm ml-2 font-bold transition cursor-pointer">{t('Logout')}</button>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row flex-1 md:h-[720px]">
                    {/* 左侧边栏 */}
                    <div className="w-full md:w-[260px] bg-[#f8f9fa] border-b md:border-b-0 md:border-r border-gray-200 p-3 md:p-6 flex md:flex-col gap-1 overflow-x-auto flex-shrink-0" role="tablist">
                        {TABS.map(([name, icon, label, countKey]) => {
                            const count = name === 'support' ? supportUnread : countKey ? overview?.[countKey] : 0;
                            return (
                                <div key={name} onClick={() => go(name)} onKeyDown={(e) => { if (e.key === 'Enter') go(name); }} tabIndex={0} role="tab" aria-selected={tab === name} className={getTabClass(name)}>
                                    <span className="text-lg">{icon}</span> {t(label)}
                                    {count > 0 && <span className="ml-auto bg-[#e11d48] text-white text-[10px] px-2 py-0.5 rounded-full">{count}</span>}
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex-1 bg-white overflow-hidden flex flex-col min-h-[600px] md:min-h-0">
                        {tab === 'overview' && <Overview data={overview} go={go} />}
                        {tab === 'verifications' && <VerificationQueue onChange={loadOverview} />}
                        {tab === 'listings' && <ListingQueue onChange={loadOverview} />}
                        {tab === 'reviews' && <ReviewQueue onChange={loadOverview} />}
                        {tab === 'reports' && <ReportQueue onChange={loadOverview} />}
                        {tab === 'users' && <Users onChange={loadOverview} currentUserId={user.id} />}
                        {tab === 'reviewers' && <Reviewers />}
                        {tab === 'campuses' && <Campuses />}
                        {tab === 'support' && <Messages chat={chat} title={t('Support Conversations')} asAdmin />}
                        {tab === 'audit' && <AuditLog />}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminPortal;
