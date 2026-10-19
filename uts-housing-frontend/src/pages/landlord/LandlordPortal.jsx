import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// 引入拆分出去的 5 个独立页面
import Dashboard from './Dashboard';
import Messages from './Messages';
import AddListing from './AddListing';
import ManageListings from './ManageListings';
import Reviews from './Reviews';

// --- 共享的初始模拟数据 ---
const initialContacts = [
    { id: 1, name: 'Marcus Ting', role: 'Verified Student', property: 'Taman Universiti Room', avatar: 'MT', unread: 1 },
    { id: 2, name: 'Sarah Tan', role: 'Verified Student', property: 'Sibu Jaya Shared Apt', avatar: 'ST', unread: 0 },
    { id: 3, name: 'Alex Lee', role: 'Verified Student', property: 'General Inquiry', avatar: 'AL', unread: 0 }
];

const initialChats = {
    1: [
        { id: 1, sender: 'me', text: 'Hello Marcus, thanks for your interest in the Taman Universiti Room.', time: '10:00 AM' },
        { id: 2, sender: 'Marcus Ting', text: 'Hi Mr. Wong! Is the security deposit negotiable?', time: '10:05 AM' },
        { id: 3, sender: 'me', text: 'The room is available next month. We can discuss the deposit if you sign a 1-year lease.', time: '10:10 AM' }
    ],
    2: [
        { id: 1, sender: 'Sarah Tan', text: 'Hi Mr. Wong, is the shared apartment still available for next semester?', time: 'Yesterday' }
    ],
    3: [
        { id: 1, sender: 'Alex Lee', text: 'Hello! Do you happen to have any properties that allow pets?', time: 'Tuesday' },
        { id: 2, sender: 'me', text: 'Hi Alex, unfortunately all our current listings have a strict no-pets policy.', time: 'Tuesday' }
    ]
};

const initialReviews = [
    {
        id: 1,
        student: 'Amanda K.',
        avatar: 'AK',
        avatarBg: 'bg-[#eff6ff] text-[#2563eb]',
        year: 'Year 2',
        property: 'Taman Universiti Room',
        rating: 5,
        text: '"Mr. Wong is a fantastic landlord. The room was exactly as described on the platform, and the deposit was returned promptly at the end of the semester. Highly recommended!"',
        reply: ''
    },
    {
        id: 2,
        student: 'Jason L.',
        avatar: 'JL',
        avatarBg: 'bg-[#f3f4f6] text-gray-600',
        year: 'Year 4',
        property: 'Sibu Jaya Single Room',
        rating: 4,
        text: '"Good location, very close to campus. Wi-Fi was occasionally slow during exam week, but the landlord was very responsive when fixing the air conditioner."',
        reply: 'Thank you for the feedback, Jason! We have upgraded our router to Wi-Fi 6 this semester.'
    }
];

const initialProperties = [
    { 
        id: 1, 
        title: 'Single Room @ Sibu Jaya', 
        rent: 450, 
        deposit: 900, 
        distance: 2.5, 
        roomType: 'Single Room', 
        facilities: ['High-Speed Wi-Fi', 'Air Conditioning'], 
        image: null,
        status: 'Active' 
    },
    { 
        id: 2, 
        title: 'Shared Apartment @ Wong King Huo', 
        rent: 300, 
        deposit: 300, 
        distance: 4.0, 
        roomType: 'Shared Room', 
        facilities: ['High-Speed Wi-Fi', 'Washing Machine'], 
        image: null,
        status: 'Active' 
    }
];

const LandlordPortal = () => {
    const navigate = useNavigate();
    
    // 当前激活的页面 Tab
    const [activeTab, setActiveTab] = useState('dashboard');
    
    // 集中管理跨页面共享的状态
    const [myProperties, setMyProperties] = useState(initialProperties);
    const [contacts, setContacts] = useState(initialContacts);
    const [activeContactId, setActiveContactId] = useState(1);
    const [chats, setChats] = useState(initialChats);
    const [reviews, setReviews] = useState(initialReviews);

    // 计算未读消息总数（用于左侧边栏红点）
    const totalUnread = contacts.reduce((sum, c) => sum + c.unread, 0);

    const getTabClass = (tabName) => {
        return activeTab === tabName
            ? "flex items-center gap-3 bg-[#e0e7ff] text-[#1d4ed8] font-bold px-4 py-3 rounded-lg cursor-pointer transition-colors"
            : "flex items-center gap-3 text-gray-600 font-bold px-4 py-3 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors";
    };

    return (
        <div className="min-h-screen bg-[#f3f4f6] p-8 font-sans relative">
            <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.05)] border border-gray-200 overflow-hidden flex flex-col">
                
                {/* 顶部 Navbar */}
                <div className="bg-[#0f172a] px-8 py-5 flex justify-between items-center">
                    <h1 className="text-white text-xl font-bold tracking-wide">UTS Housing Provider Portal</h1>
                    <div className="flex items-center gap-4">
                        <span className="bg-[#22c55e] text-white text-[11px] font-bold px-3 py-1 rounded flex items-center gap-1">
                            ✓ Verified Landlord
                        </span>
                        <span className="text-white font-bold text-sm">Mr. Wong</span>
                        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white text-sm ml-2 font-bold transition cursor-pointer">
                            Logout
                        </button>
                    </div>
                </div>

                {/* 主体内容区 */}
                <div className="flex flex-1 h-[680px]">
                    
                    {/* 左侧边栏 Sidebar */}
                    <div className="w-[260px] bg-[#f8f9fa] border-r border-gray-200 p-6 space-y-2 flex-shrink-0">
                        <div onClick={() => setActiveTab('dashboard')} className={getTabClass('dashboard')}>
                            <span className="text-lg">📊</span> Dashboard
                        </div>
                        <div onClick={() => setActiveTab('messages')} className={getTabClass('messages')}>
                            <span className="text-lg">💬</span> Messages 
                            {totalUnread > 0 && (
                                <span className="ml-auto bg-[#e11d48] text-white text-[10px] px-2 py-0.5 rounded-full">
                                    {totalUnread}
                                </span>
                            )}
                        </div>
                        <div onClick={() => setActiveTab('add')} className={getTabClass('add')}>
                            <span className="text-lg">➕</span> Add New Listing
                        </div>
                        <div onClick={() => setActiveTab('manage')} className={getTabClass('manage')}>
                            <span className="text-lg">🏠</span> Manage Listings <span className="text-xs ml-auto">({myProperties.length})</span>
                        </div>
                        <div onClick={() => setActiveTab('reviews')} className={getTabClass('reviews')}>
                            <span className="text-lg">⭐</span> Student Reviews
                        </div>
                    </div>

                    {/* 右侧动态渲染对应的独立子组件 */}
                    <div className="flex-1 bg-white overflow-hidden flex flex-col">
                        {activeTab === 'dashboard' && (
                            <Dashboard 
                                myProperties={myProperties} 
                                contacts={contacts} 
                                setActiveTab={setActiveTab} 
                                setActiveContactId={setActiveContactId}
                                setContacts={setContacts}
                            />
                        )}
                        {activeTab === 'messages' && (
                            <Messages 
                                contacts={contacts} 
                                setContacts={setContacts} 
                                activeContactId={activeContactId} 
                                setActiveContactId={setActiveContactId} 
                                chats={chats} 
                                setChats={setChats} 
                            />
                        )}
                        {activeTab === 'add' && (
                            <AddListing 
                                myProperties={myProperties} 
                                setMyProperties={setMyProperties} 
                                setActiveTab={setActiveTab} 
                            />
                        )}
                        {activeTab === 'manage' && (
                            <ManageListings 
                                myProperties={myProperties} 
                                setMyProperties={setMyProperties} 
                                setActiveTab={setActiveTab} 
                            />
                        )}
                        {activeTab === 'reviews' && (
                            <Reviews 
                                reviews={reviews} 
                                setReviews={setReviews} 
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LandlordPortal;