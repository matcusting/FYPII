import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { useConversations } from '../../hooks/useConversations';
import NotificationBell from '../../components/NotificationBell';
import { VerificationBanner } from '../../components/ui';

// 拆分出去的独立页面
import Dashboard from './Dashboard';
import Messages from './Messages';
import AddListing from './AddListing';
import ManageListings from './ManageListings';
import Reviews from './Reviews';
import AccountSettings from './AccountSettings';

const LandlordPortal = () => {
    const navigate = useNavigate();
    const { user, logout } = useAuth();

    // 当前激活的页面 Tab
    const [activeTab, setActiveTab] = useState('dashboard');

    // 集中管理跨页面共享的状态（来自后端 API）
    const [myProperties, setMyProperties] = useState([]);
    const [listingsLoading, setListingsLoading] = useState(true);
    const [reviewData, setReviewData] = useState({ summary: { average: null, count: 0 }, reviews: [] });
    const [notifications, setNotifications] = useState([]);
    const chat = useConversations();

    const loadListings = useCallback(async () => {
        try {
            setMyProperties(await api('/listings/mine'));
        } finally {
            setListingsLoading(false);
        }
    }, []);
    const loadReviews = useCallback(() => api('/reviews/landlord').then(setReviewData).catch(() => {}), []);
    const loadNotifications = useCallback(() => api('/notifications').then(setNotifications).catch(() => {}), []);

    useEffect(() => {
        loadListings();
        loadReviews();
        loadNotifications();
    }, [loadListings, loadReviews, loadNotifications]);

    // 计算未读消息总数（用于左侧边栏红点）
    const totalUnread = chat.conversations.reduce((sum, c) => sum + c.unread, 0);

    const handleLogout = async () => {
        await logout();
        navigate('/');
    };

    const getTabClass = (tabName) => {
        return activeTab === tabName
            ? "flex items-center gap-3 bg-[#e0e7ff] text-[#1d4ed8] font-bold px-4 py-3 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            : "flex items-center gap-3 text-gray-600 font-bold px-4 py-3 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors whitespace-nowrap";
    };

    const tab = (name, icon, label, extra) => (
        <div
            onClick={() => setActiveTab(name)}
            onKeyDown={(e) => { if (e.key === 'Enter') setActiveTab(name); }}
            tabIndex={0}
            role="tab"
            aria-selected={activeTab === name}
            className={getTabClass(name)}
        >
            <span className="text-lg">{icon}</span> {label} {extra}
        </div>
    );

    return (
        <div className="min-h-screen bg-[#f3f4f6] p-3 sm:p-8 font-sans relative">
            <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.05)] border border-gray-200 overflow-hidden flex flex-col">

                {/* 顶部 Navbar */}
                <div className="bg-[#0f172a] px-5 sm:px-8 py-5 flex flex-wrap gap-3 justify-between items-center">
                    <h1 className="text-white text-xl font-bold tracking-wide">UTS Housing Provider Portal</h1>
                    <div className="flex items-center gap-4">
                        {user.landlordVerified ? (
                            <span className="bg-[#22c55e] text-white text-[11px] font-bold px-3 py-1 rounded flex items-center gap-1">
                                ✓ Verified Landlord
                            </span>
                        ) : (
                            <span className="bg-[#eab308] text-white text-[11px] font-bold px-3 py-1 rounded flex items-center gap-1">
                                ⏳ Verification Pending
                            </span>
                        )}
                        <NotificationBell dark />
                        <span className="text-white font-bold text-sm">{user.name}</span>
                        <button onClick={handleLogout} className="text-gray-400 hover:text-white text-sm ml-2 font-bold transition cursor-pointer">
                            Logout
                        </button>
                    </div>
                </div>

                {/* 主体内容区 */}
                <div className="flex flex-col md:flex-row flex-1 md:h-[680px]">

                    {/* 左侧边栏 Sidebar */}
                    <div className="w-full md:w-[260px] bg-[#f8f9fa] border-b md:border-b-0 md:border-r border-gray-200 p-3 md:p-6 flex md:flex-col gap-2 md:space-y-0 overflow-x-auto flex-shrink-0" role="tablist">
                        {tab('dashboard', '📊', 'Dashboard')}
                        {tab('messages', '💬', 'Messages', totalUnread > 0 && (
                            <span className="ml-auto bg-[#e11d48] text-white text-[10px] px-2 py-0.5 rounded-full">
                                {totalUnread}
                            </span>
                        ))}
                        {tab('add', '➕', 'Add New Listing')}
                        {tab('manage', '🏠', 'Manage Listings', <span className="text-xs ml-auto">({myProperties.length})</span>)}
                        {tab('reviews', '⭐', 'Student Reviews')}
                        {tab('settings', '⚙️', 'Account Settings')}
                    </div>

                    {/* 右侧动态渲染对应的独立子组件 */}
                    <div className="flex-1 bg-white overflow-hidden flex flex-col min-h-[600px] md:min-h-0">
                        {activeTab !== 'messages' && <VerificationBanner className="mx-4 sm:mx-10 mt-6 -mb-4" />}
                        {activeTab === 'dashboard' && (
                            <Dashboard
                                myProperties={myProperties}
                                conversations={chat.conversations}
                                notifications={notifications}
                                reviewSummary={reviewData.summary}
                                setActiveTab={setActiveTab}
                                setActiveContactId={chat.setActiveId}
                            />
                        )}
                        {activeTab === 'messages' && <Messages chat={chat} />}
                        {activeTab === 'add' && (
                            <AddListing
                                onCreated={async () => { await loadListings(); setActiveTab('manage'); }}
                            />
                        )}
                        {activeTab === 'manage' && (
                            <ManageListings
                                myProperties={myProperties}
                                loading={listingsLoading}
                                reload={loadListings}
                                setActiveTab={setActiveTab}
                            />
                        )}
                        {activeTab === 'reviews' && (
                            <Reviews
                                data={reviewData}
                                reload={loadReviews}
                                landlordName={user.name}
                            />
                        )}
                        {activeTab === 'settings' && <AccountSettings />}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LandlordPortal;
