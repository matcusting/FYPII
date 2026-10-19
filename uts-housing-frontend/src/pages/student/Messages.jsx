import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';

// 模拟联系人列表（为房东绑定对应的房源详情数据）
const mockContacts = [
    { 
        id: 1, 
        name: 'Mr. Wong', 
        role: 'Verified Landlord', 
        avatar: 'W', 
        unread: 1,
        propertyDetails: {
            title: 'Taman Universiti Room',
            rent: 450,
            deposit: 900,
            distance: 1.2,
            roomType: 'Single Room',
            landlord: 'Mr. Wong',
            facilities: ['High-Speed Wi-Fi', 'Air Conditioning', 'Washing Machine', 'Water Heater', 'Study Desk'],
            description: 'Spacious and quiet single room located right next to UTS campus. Walking distance to local eateries and supermarkets. Ideal for students looking for a conducive study environment.'
        }
    },
    { id: 2, name: 'Alex Lee', role: 'Student (95% Match)', avatar: 'AL', unread: 0 },
    { id: 3, name: 'Admin Support', role: 'System', avatar: 'S', unread: 0 }
];

// 按 ID 分配的独立聊天记录
const initialChats = {
    1: [
        { id: 1, sender: 'Mr. Wong', text: 'Hello Marcus, thanks for your interest in the Taman Universiti Room.', time: '10:00 AM' },
        { id: 2, sender: 'me', text: 'Hi Mr. Wong! Is the security deposit negotiable?', time: '10:05 AM' },
        { id: 3, sender: 'Mr. Wong', text: 'The room is available next month. We can discuss the deposit if you sign a 1-year lease.', time: '10:10 AM' }
    ],
    2: [
        { id: 1, sender: 'Alex Lee', text: 'Hey Marcus! I saw we have a 95% match. Want to look for an apartment together?', time: 'Yesterday' },
        { id: 2, sender: 'me', text: 'Hi Alex! Yes, that sounds great. What is your budget?', time: 'Yesterday' }
    ],
    3: [
        { id: 1, sender: 'Admin Support', text: 'Welcome to UTS Housing & Roommate Finder! If you have any issues with your account, please reply here.', time: 'Monday' }
    ]
};

const Messages = () => {
    const navigate = useNavigate();
    
    const [activeContactId, setActiveContactId] = useState(1);
    const [chats, setChats] = useState(initialChats);
    const [newMessage, setNewMessage] = useState('');
    
    // 新增：控制 View Property 弹窗显示的状态
    const [showPropertyModal, setShowPropertyModal] = useState(false);

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;
        
        const newMsg = {
            id: Date.now(),
            sender: 'me',
            text: newMessage,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        
        setChats(prevChats => ({
            ...prevChats,
            [activeContactId]: [...(prevChats[activeContactId] || []), newMsg]
        }));
        
        setNewMessage('');
    };

    const activeContact = mockContacts.find(c => c.id === activeContactId);
    const currentChatHistory = chats[activeContactId] || [];

    return (
        <div className="min-h-screen bg-[#f8f9fa] pb-20 font-sans relative">
            <Navbar />

            <div className="w-[1000px] mx-auto mb-4">
                <button onClick={() => navigate('/student')} className="text-gray-500 hover:text-gray-800 font-bold text-sm flex items-center gap-1 transition-colors cursor-pointer">
                    ← Back to Dashboard
                </button>
            </div>

            <div className="w-[1000px] mx-auto bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] rounded-xl overflow-hidden border border-gray-100 flex h-[650px]">
                
                {/* 左侧：联系人列表 */}
                <div className="w-[320px] bg-[#fcfcfd] border-r border-gray-200 flex flex-col">
                    <div className="p-6 border-b border-gray-200 bg-white">
                        <h2 className="text-xl font-bold text-[#1f2937]">Messages</h2>
                    </div>
                    
                    <div className="overflow-y-auto flex-1">
                        {mockContacts.map(contact => {
                            const isActive = contact.id === activeContactId;
                            return (
                                <div 
                                    key={contact.id} 
                                    onClick={() => setActiveContactId(contact.id)}
                                    className={`p-4 border-b border-gray-100 cursor-pointer flex items-center gap-4 transition-colors ${isActive ? 'bg-[#f0f4f8] border-l-4 border-l-[#203569]' : 'hover:bg-gray-50 border-l-4 border-l-transparent'}`}
                                >
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg transition-colors ${isActive ? 'bg-[#203569] text-white' : 'bg-[#e2e8f0] text-gray-600'}`}>
                                        {contact.avatar}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center mb-1">
                                            <h3 className={`font-bold truncate ${isActive ? 'text-[#203569]' : 'text-gray-800'}`}>{contact.name}</h3>
                                            {contact.unread > 0 && (
                                                <span className="bg-[#e11d48] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                                    {contact.unread}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[12px] text-gray-500 truncate">{contact.role}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 右侧：聊天对话框 */}
                <div className="flex-1 flex flex-col bg-white">
                    <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-white shadow-sm z-10">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-[#203569] text-white rounded-full flex items-center justify-center font-bold">
                                {activeContact.avatar}
                            </div>
                            <div>
                                <h3 className="font-bold text-[#1f2937] text-[1.1rem]">{activeContact.name}</h3>
                                <p className="text-[12px] text-[#16a34a] font-medium flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-[#16a34a] rounded-full inline-block"></span> Online
                                </p>
                            </div>
                        </div>
                        
                        {/* 激活后的 View Property 按钮 */}
                        {activeContact.propertyDetails && (
                            <button 
                                onClick={() => setShowPropertyModal(true)}
                                className="text-[13px] font-bold text-[#203569] border border-[#203569] px-4 py-1.5 rounded-md hover:bg-blue-50 transition cursor-pointer"
                            >
                                View Property
                            </button>
                        )}
                    </div>

                    {/* 聊天记录滚动区 */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#f8f9fa]">
                        {currentChatHistory.map(msg => (
                            <div key={msg.id} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                                <div className="max-w-[70%]">
                                    <div className={`p-4 rounded-2xl ${msg.sender === 'me' ? 'bg-[#203569] text-white rounded-tr-none shadow-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'}`}>
                                        <p className="text-[14px] leading-relaxed">{msg.text}</p>
                                    </div>
                                    <p className={`text-[11px] text-gray-400 mt-1.5 font-medium ${msg.sender === 'me' ? 'text-right' : 'text-left'}`}>
                                        {msg.time} {msg.sender === 'me' && '✓'}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 输入框区域 */}
                    <div className="p-4 border-t border-gray-200 bg-white">
                        <form onSubmit={handleSendMessage} className="flex gap-3">
                            <input 
                                type="text" 
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                placeholder="Type your message here..." 
                                className="flex-1 bg-[#f4f7fb] border border-[#e0e7ff] rounded-full px-6 py-3 text-[14px] outline-none focus:border-[#203569] focus:bg-white transition-colors"
                            />
                            <button 
                                type="submit"
                                disabled={!newMessage.trim()}
                                className="bg-[#203569] text-white w-12 h-12 rounded-full flex items-center justify-center hover:bg-[#1a2b56] transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                                <span className="transform rotate-45 -mt-1 ml-1 text-lg">✈</span>
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            {/* --- 新增：点击 View Property 弹出的房源详情窗口 --- */}
            {showPropertyModal && activeContact.propertyDetails && (
                <div 
                    onClick={() => setShowPropertyModal(false)}
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
                >
                    <div 
                        onClick={(e) => e.stopPropagation()} 
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-[600px] overflow-hidden border border-gray-100"
                    >
                        <div className="h-[200px] bg-[#cbd5e1] relative flex items-center justify-center">
                            <span className="text-gray-500 font-bold text-lg">Property Image Gallery</span>
                            <button 
                                onClick={() => setShowPropertyModal(false)}
                                className="absolute top-4 right-4 w-9 h-9 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center font-bold text-xl transition cursor-pointer"
                            >
                                ×
                            </button>
                            <span className="absolute bottom-4 left-6 bg-[#203569] text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-sm">
                                {activeContact.propertyDetails.roomType}
                            </span>
                        </div>

                        <div className="p-8">
                            <div className="flex justify-between items-start border-b border-gray-100 pb-5 mb-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-[#1f2937]">{activeContact.propertyDetails.title}</h2>
                                    <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                                        <span>Landlord: <strong className="text-gray-800">{activeContact.propertyDetails.landlord}</strong></span>
                                        <span className="bg-[#dcfce7] text-[#15803d] text-[10px] font-bold px-2 py-0.5 rounded">✓ Verified</span>
                                        <span>• {activeContact.propertyDetails.distance} km to UTS</span>
                                    </p>
                                </div>
                                <div className="text-right">
                                    <div className="text-2xl font-bold text-[#16a34a]">RM {activeContact.propertyDetails.rent}<span className="text-sm text-gray-500 font-normal">/mo</span></div>
                                    <div className="text-xs text-gray-400 font-medium mt-0.5">Deposit: RM {activeContact.propertyDetails.deposit}</div>
                                </div>
                            </div>

                            <div className="mb-6">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">About this property</h4>
                                <p className="text-gray-600 text-sm leading-relaxed">
                                    {activeContact.propertyDetails.description}
                                </p>
                            </div>

                            <div className="mb-8">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Included Facilities</h4>
                                <div className="flex flex-wrap gap-2">
                                    {activeContact.propertyDetails.facilities.map((fac, idx) => (
                                        <span key={idx} className="bg-[#f0f4f8] text-[#203569] text-xs font-bold px-3.5 py-1.5 rounded-full">
                                            ✓ {fac}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                                <button 
                                    onClick={() => navigate('/student/housing')}
                                    className="px-5 py-2.5 border border-gray-300 text-gray-700 font-bold text-sm rounded-xl hover:bg-gray-50 transition cursor-pointer"
                                >
                                    Browse All Listings
                                </button>
                                <button 
                                    onClick={() => setShowPropertyModal(false)}
                                    className="px-6 py-2.5 bg-[#203569] text-white font-bold text-sm rounded-xl hover:bg-[#1a2b56] transition cursor-pointer"
                                >
                                    Back to Chat
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Messages;