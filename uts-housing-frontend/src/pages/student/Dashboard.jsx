import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import NotificationBell from '../../components/NotificationBell';
import { VerificationBanner } from '../../components/ui';

const Dashboard = () => {
    const navigate = useNavigate();
    const { user, unreadMessages, logout } = useAuth();
    const firstName = user.name.split(' ')[0];

    const handleLogout = async () => {
        await logout();
        navigate('/');
    };

    return (
        <div className="min-h-screen bg-[#f8f9fa] pt-8 pb-20 font-sans">
            <div className="max-w-[1000px] w-[calc(100%-2rem)] mx-auto bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] rounded-xl overflow-hidden border border-gray-100">
                
                {/* 修复后的顶部 Header：加入了 Profile 跳转 和 Logout */}
                <div className="bg-[#203569] text-white px-5 sm:px-8 py-4 flex flex-wrap gap-2 justify-between items-center">
                    <h1 className="text-xl tracking-wide font-semibold">UTS Housing & Roommate Finder</h1>
                    
                    <div className="flex items-center gap-2">
                        <NotificationBell dark />
                        {/* 变成可点击的 Profile 按钮 */}
                        <button 
                            onClick={() => navigate('/student/profile')}
                            className="flex items-center gap-3 hover:bg-[#1a2b56] px-3 py-2 rounded-lg transition cursor-pointer"
                        >
                            {/* 换成带有首字母的头像，更显专业 */}
                            <div className="w-8 h-8 bg-blue-100 text-[#203569] rounded-full flex items-center justify-center font-bold text-sm">
                                {user.initials}
                            </div>
                            <span className="font-semibold text-sm hidden sm:inline">{user.name}</span>
                        </button>
                        
                        {/* 竖线分隔符 */}
                        <div className="h-5 w-px bg-white/20 mx-2"></div>
                        
                        {/* Logout 按钮 */}
                        <button 
                            onClick={handleLogout} 
                            className="text-gray-300 hover:text-white text-sm font-bold transition px-2"
                        >
                            Logout
                        </button>
                    </div>
                </div>

                <div className="p-6 sm:p-10 min-h-[500px]">
                    <VerificationBanner className="mb-8" />
                    <div className="mb-8">
                        <h2 className="text-[1.8rem] sm:text-[2.2rem] font-bold text-[#1f2937] mb-2">Welcome back, {firstName}!</h2>
                        <p className="text-gray-500 text-lg">What are you looking for today?</p>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
                        {/* 左侧卡片：Find Housing */}
                        <div 
                            onClick={() => navigate('/student/housing')}
                            className="bg-[#f4f7fb] border border-[#e0e7ff] rounded-2xl p-10 flex flex-col items-center text-center cursor-pointer hover:shadow-lg transition-all duration-300 group"
                        >
                            <div className="w-20 h-20 bg-[#203569] rounded-full flex items-center justify-center mb-6 group-hover:scale-105 transition-transform">
                                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M3 9.5L12 3L21 9.5V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V9.5Z" fill="#e2e8f0"/>
                                    <path d="M3 9.5L12 3L21 9.5" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M9 21V13H15V21" fill="#cbd5e1"/>
                                </svg>
                            </div>
                            <h3 className="text-2xl font-bold text-[#203569] mb-2">Find Housing</h3>
                            <p className="text-[#3b82f6] text-sm">Browse verified rental listings near UTS campus.</p>
                        </div>

                        {/* 右侧卡片：Find a Roommate */}
                        <div 
                            onClick={() => navigate('/student/roommates')}
                            className="bg-[#f0fdf4] border border-[#dcfce7] rounded-2xl p-10 flex flex-col items-center text-center cursor-pointer hover:shadow-lg transition-all duration-300 group"
                        >
                            <div className="w-20 h-20 bg-[#15803d] rounded-full flex items-center justify-center mb-6 group-hover:scale-105 transition-transform">
                                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M16 21V19C16 17.8954 15.1046 17 14 17H6C4.89543 17 4 17.8954 4 19V21" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M10 13C11.6569 13 13 11.6569 13 10C13 8.34315 11.6569 7 10 7C8.34315 7 7 8.34315 7 10C7 11.6569 8.34315 13 10 13Z" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M20 21V19C20 18.1065 19.3906 17.354 18.5432 17.0864M15 7.15939C16.1437 7.50293 17 8.64724 17 10C17 11.3528 16.1437 12.4971 15 12.8406" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </div>
                            <h3 className="text-2xl font-bold text-[#15803d] mb-2">Find a Roommate</h3>
                            <p className="text-[#16a34a] text-sm">Match with students based on lifestyle habits.</p>
                        </div>
                    </div>

                    {/* 快捷入口 */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                        {[
                            { icon: '❤️', label: 'Saved Listings', text: 'Rooms you added to your wishlist', to: '/student/favorites' },
                            { icon: '💬', label: 'Messages', text: unreadMessages > 0 ? `${unreadMessages} unread message${unreadMessages > 1 ? 's' : ''}` : 'Chat with landlords & roommates', to: '/student/messages' },
                            { icon: '⭐', label: 'Profile & Reviews', text: 'Your details, verification & reviews', to: '/student/profile' },
                        ].map((item) => (
                            <div
                                key={item.label}
                                onClick={() => navigate(item.to)}
                                className="border border-gray-200 rounded-xl p-5 flex items-center gap-4 cursor-pointer hover:shadow-md hover:border-[#203569] transition-all bg-white"
                            >
                                <span className="text-2xl">{item.icon}</span>
                                <div>
                                    <h4 className="font-bold text-[#203569] text-[15px]">{item.label}</h4>
                                    <p className="text-[12px] text-gray-500">{item.text}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;