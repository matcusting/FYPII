import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const Navbar = () => {
    const navigate = useNavigate();
    const location = useLocation(); 

    // 判断当前是否在主页，如果在主页则隐藏 Dashboard 按钮
    const isDashboard = location.pathname === '/student';

    return (
        <div className="sticky top-0 z-50 w-full bg-white/90 backdrop-blur-md border-b border-gray-200 shadow-sm font-sans mb-6">
            <div className="w-[1000px] mx-auto h-16 flex justify-between items-center">
                
                {/* 左侧 Logo 和标题 (点击可回主页) */}
                <div 
                    onClick={() => navigate('/student')}
                    className="flex items-center gap-3 cursor-pointer group"
                >
                    <div className="w-10 h-10 bg-[#203569] rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm group-hover:bg-[#1a2b56] transition-colors">
                        UTS
                    </div>
                    <span className="font-bold text-[#1f2937] text-[1.1rem] group-hover:text-[#203569] transition-colors">
                        Housing & Roommate Finder
                    </span>
                </div>
                
                {/* 右侧导航菜单 */}
                <div className="flex items-center gap-6">
                    {!isDashboard && (
                        <button 
                            onClick={() => navigate('/student')} 
                            className="text-sm font-bold text-gray-500 hover:text-[#203569] transition-colors"
                        >
                            Dashboard
                        </button>
                    )}
                    
                    {/* Messages 按钮 (带红点和跳转功能) */}
                    <button 
                        onClick={() => navigate('/student/messages')}
                        className="text-sm font-bold text-gray-500 hover:text-[#203569] transition-colors flex items-center gap-1.5 relative cursor-pointer"
                    >
                        <span className="text-lg">💬</span> Messages
                        <span className="absolute -top-1.5 -right-2 bg-[#e11d48] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white shadow-sm">
                            1
                        </span>
                    </button>

                    {/* Profile 按钮 (跳转至个人设置) */}
                    <button 
                        onClick={() => navigate('/student/profile')}
                        className="text-sm font-bold text-gray-500 hover:text-[#203569] transition-colors flex items-center gap-1.5"
                    >
                        <span className="text-lg">👤</span> Profile
                    </button>
                    
                    {/* 竖线分隔符 */}
                    <div className="h-5 w-px bg-gray-300 mx-1"></div>

                    {/* Logout 按钮 (退回登录页) */}
                    <button 
                        onClick={() => navigate('/')} 
                        className="text-sm font-bold text-gray-400 hover:text-red-600 transition-colors flex items-center gap-1"
                    >
                        Logout
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Navbar;