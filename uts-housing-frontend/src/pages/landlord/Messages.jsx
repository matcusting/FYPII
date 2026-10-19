import React, { useState } from 'react';

const Messages = ({ contacts, setContacts, activeContactId, setActiveContactId, chats, setChats }) => {
    const [newMessage, setNewMessage] = useState('');

    const handleSelectContact = (id) => {
        setActiveContactId(id);
        setContacts(contacts.map(c => c.id === id ? { ...c, unread: 0 } : c));
    };

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

    const activeContact = contacts.find(c => c.id === activeContactId);
    const currentChatHistory = chats[activeContactId] || [];

    return (
        <div className="flex flex-1 h-full animate-fade-in-up">
            {/* 左侧联系人列表 */}
            <div className="w-[300px] bg-[#fcfcfd] border-r border-gray-200 flex flex-col">
                <div className="p-5 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-[#1f2937]">Student Inquiries</h2>
                </div>
                <div className="overflow-y-auto flex-1">
                    {contacts.map(contact => {
                        const isActive = contact.id === activeContactId;
                        return (
                            <div 
                                key={contact.id} 
                                onClick={() => handleSelectContact(contact.id)}
                                className={`p-4 border-b border-gray-100 cursor-pointer flex items-center gap-3 transition-colors ${isActive ? 'bg-[#f0f4f8] border-l-4 border-l-[#1d4ed8]' : 'hover:bg-gray-50 border-l-4 border-l-transparent'}`}
                            >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${isActive ? 'bg-[#1d4ed8] text-white' : 'bg-[#e2e8f0] text-gray-600'}`}>
                                    {contact.avatar}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-center mb-0.5">
                                        <h3 className={`font-bold text-[13px] truncate ${isActive ? 'text-[#1d4ed8]' : 'text-gray-800'}`}>{contact.name}</h3>
                                        {contact.unread > 0 && <span className="bg-[#e11d48] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{contact.unread}</span>}
                                    </div>
                                    <p className="text-[11px] text-gray-500 truncate">RE: {contact.property}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            
            {/* 右侧对话框 */}
            <div className="flex-1 flex flex-col bg-white">
                <div className="p-5 border-b border-gray-200 flex justify-between items-center shadow-sm z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#eff6ff] text-[#1d4ed8] rounded-full flex items-center justify-center font-bold">{activeContact.avatar}</div>
                        <div>
                            <h3 className="font-bold text-[#0f172a] text-[15px]">{activeContact.name}</h3>
                            <p className="text-[11px] text-gray-500 font-medium">{activeContact.role}</p>
                        </div>
                    </div>
                    <span className="text-xs bg-gray-100 text-gray-600 font-bold px-3 py-1.5 rounded-md border border-gray-200">
                        Inquiry: {activeContact.property}
                    </span>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-[#f8f9fa]">
                    {currentChatHistory.map(msg => (
                        <div key={msg.id} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                            <div className="max-w-[70%]">
                                <div className={`p-4 rounded-2xl ${msg.sender === 'me' ? 'bg-[#0f172a] text-white rounded-tr-none shadow-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'}`}>
                                    <p className="text-[13px] leading-relaxed">{msg.text}</p>
                                </div>
                                <p className={`text-[10px] text-gray-400 mt-1.5 font-medium ${msg.sender === 'me' ? 'text-right' : 'text-left'}`}>
                                    {msg.time} {msg.sender === 'me' && '✓'}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="p-4 border-t border-gray-200 bg-white">
                    <form onSubmit={handleSendMessage} className="flex gap-3">
                        <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder={`Reply to ${activeContact.name.split(' ')[0]}...`} className="flex-1 bg-[#f4f7fb] border border-[#e0e7ff] rounded-full px-5 py-2.5 text-[13px] outline-none focus:border-[#1d4ed8] transition-colors" />
                        <button type="submit" disabled={!newMessage.trim()} className="bg-[#1d4ed8] text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-blue-800 transition disabled:opacity-50 cursor-pointer">
                            <span className="transform rotate-45 -mt-0.5 ml-0.5 text-sm">✈</span>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Messages;