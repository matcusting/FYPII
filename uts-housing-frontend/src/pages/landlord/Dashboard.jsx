import { timeAgo } from '../../lib/api';
import { useT } from '../../i18n';

// 最近动态的标签样式
const BADGES = {
    INQUIRY: ['Message', 'bg-[#dbeafe] text-[#1e40af]', 'messages'],
    MESSAGE: ['Message', 'bg-[#dbeafe] text-[#1e40af]', 'messages'],
    REVIEW: ['Review', 'bg-[#dcfce7] text-[#166534]', 'reviews'],
    LISTING_MODERATION: ['Listing', 'bg-[#f3e8ff] text-[#7e22ce]', 'manage'],
    VERIFICATION: ['Account', 'bg-[#fef9c3] text-[#a16207]', 'settings'],
};

const Dashboard = ({ myProperties, conversations, notifications, reviewSummary, setActiveTab, setActiveContactId }) => {
    const { t } = useT();
    const inquiries = conversations.filter((c) => c.type === 'LISTING_INQUIRY');
    const totalViews = myProperties.reduce((sum, p) => sum + (p.viewCount || 0), 0);
    const pending = myProperties.filter((p) => p.status === 'PENDING_REVIEW').length;
    const rejected = myProperties.filter((p) => p.status === 'REJECTED').length;
    const stale = myProperties.filter((p) => p.status === 'PUBLISHED' && p.isStale).length;

    const handleJumpToMessage = (contactId) => {
        setActiveTab('messages');
        setActiveContactId(contactId);
    };

    return (
        <div className="p-5 sm:p-10 overflow-y-auto animate-fade-in-up">
            <h2 className="text-[1.4rem] font-bold text-[#0f172a] border-b border-gray-100 pb-4 mb-8">{t('Overview Dashboard')}</h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                <div
                    onClick={() => setActiveTab('manage')}
                    className="bg-[#eff6ff] rounded-xl p-6 border border-[#bfdbfe] cursor-pointer hover:shadow-md transition"
                >
                    <div className="text-4xl font-bold text-[#1d4ed8] mb-2">
                        {myProperties.filter(p => p.status === 'PUBLISHED').length}
                    </div>
                    <div className="text-sm font-bold text-[#1d4ed8]">{t('Active Listings →')}</div>
                </div>
                <div className="bg-[#f0fdf4] rounded-xl p-6 border border-[#bbf7d0]">
                    <div className="text-4xl font-bold text-[#15803d] mb-2">{totalViews}</div>
                    <div className="text-sm font-bold text-[#15803d]">{t('Total Listing Views')}</div>
                </div>
                <div
                    onClick={() => setActiveTab('messages')}
                    className="bg-[#fefce8] rounded-xl p-6 border border-[#fef08a] cursor-pointer hover:shadow-md transition"
                >
                    <div className="text-4xl font-bold text-[#a16207] mb-2">{inquiries.length}</div>
                    <div className="text-sm font-bold text-[#a16207]">{t('Student Inquiries →')}</div>
                </div>
            </div>

            {/* 需要处理的事项 */}
            {(pending > 0 || rejected > 0 || stale > 0) && (
                <div className="space-y-2 mb-8">
                    {pending > 0 && <p onClick={() => setActiveTab('manage')} className="bg-[#fefce8] border border-[#fef08a] text-[#a16207] text-[13px] font-bold px-4 py-3 rounded-lg cursor-pointer">⏳ {t('{n} listing(s) waiting for review.', { n: pending })}</p>}
                    {rejected > 0 && <p onClick={() => setActiveTab('manage')} className="bg-[#fee2e2] border border-[#fecaca] text-[#b91c1c] text-[13px] font-bold px-4 py-3 rounded-lg cursor-pointer">✖ {t('{n} listing(s) were not approved — see the reason and resubmit.', { n: rejected })}</p>}
                    {stale > 0 && <p onClick={() => setActiveTab('manage')} className="bg-[#eff6ff] border border-[#bfdbfe] text-[#1d4ed8] text-[13px] font-bold px-4 py-3 rounded-lg cursor-pointer">🔄 {t('{n} listing(s) need you to confirm they are still available.', { n: stale })}</p>}
                </div>
            )}

            {reviewSummary.count > 0 && (
                <p className="text-sm text-gray-600 mb-8">
                    {t('Your rating:')} <strong className="text-[#eab308]">{reviewSummary.average} ★</strong> {t('from {n} verified reviews.', { n: reviewSummary.count })}
                </p>
            )}

            <h3 className="text-[1.1rem] font-bold text-[#0f172a] mb-4">{t('Recent Activity')}</h3>
            <div className="space-y-0">
                {notifications.length === 0 && inquiries.length === 0 && <p className="text-sm text-gray-400 font-bold py-4">{t('No activity yet.')}</p>}
                {inquiries.slice(0, 3).map((c) => (
                    <div
                        key={c.id}
                        onClick={() => handleJumpToMessage(c.id)}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-4 border-b border-gray-100 hover:bg-gray-50 px-3 rounded-lg cursor-pointer transition"
                    >
                        <div className="flex items-center gap-4">
                            <span className="bg-[#dbeafe] text-[#1e40af] text-[11px] font-bold px-3 py-1.5 rounded">{t('Message')}</span>
                            <span className="text-gray-600 text-sm"><strong className="text-gray-900">{c.other?.name}</strong> {t('inquired about')} "{c.listing?.title}".</span>
                        </div>
                        <span className="text-gray-400 text-sm font-medium">{timeAgo(c.updatedAt)}</span>
                    </div>
                ))}
                {notifications.filter((n) => n.type !== 'INQUIRY' && n.type !== 'MESSAGE').slice(0, 5).map((n) => {
                    const [label, cls, target] = BADGES[n.type] || ['Update', 'bg-gray-100 text-gray-600', 'dashboard'];
                    return (
                        <div
                            key={n.id}
                            onClick={() => setActiveTab(target)}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-4 border-b border-gray-100 hover:bg-gray-50 px-3 rounded-lg cursor-pointer transition"
                        >
                            <div className="flex items-center gap-4">
                                <span className={`${cls} text-[11px] font-bold px-3 py-1.5 rounded w-[68px] text-center flex-shrink-0`}>{t(label)}</span>
                                <span className="text-gray-600 text-sm"><strong className="text-gray-900">{t(n.title)}</strong> — {n.body}</span>
                            </div>
                            <span className="text-gray-400 text-sm font-medium whitespace-nowrap">{timeAgo(n.createdAt)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Dashboard;
