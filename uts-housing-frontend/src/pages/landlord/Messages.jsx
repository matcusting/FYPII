import { useEffect, useRef, useState } from 'react';
import { api, chatTime } from '../../lib/api';
import { ErrorBanner, LoadingBlock, ReportDialog } from '../../components/ui';

const Messages = ({ chat, title = 'Student Inquiries', asAdmin = false }) => {
    // 管理员看到的是用户本人的名字；房东看到的是 "Admin Support"
    const contactName = (c) => (c.type === 'SUPPORT' && !asAdmin ? 'Admin Support' : c.other?.name || 'Deleted user');
    const contactAvatar = (c) => (c.type === 'SUPPORT' && !asAdmin ? 'S' : c.other?.initials || '?');
    const contactSubject = (c) => (c.type === 'SUPPORT' ? 'Account support' : c.listing?.title || 'General Inquiry');

    const { conversations, active, activeId, setActiveId, messages, send, loading, reload, typingName, notifyTyping } = chat;
    const [newMessage, setNewMessage] = useState('');
    const [error, setError] = useState(null);
    const [reporting, setReporting] = useState(false);
    const bottomRef = useRef(null);

    // 确保 Admin Support 对话存在
    useEffect(() => {
        if (asAdmin) return;
        api('/conversations/support', { method: 'POST' }).then(reload).catch(() => {});
    }, [reload, asAdmin]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: 'end' });
    }, [messages.length, activeId]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;
        setError(null);
        try {
            await send(newMessage.trim());
            setNewMessage('');
        } catch (err) {
            setError(err);
        }
    };

    const toggleBlock = async () => {
        if (!active?.other) return;
        if (!active.blocked && !window.confirm(`Block ${active.other.name}?`)) return;
        try {
            await api(`/blocks/${active.other.id}`, { method: active.blocked ? 'DELETE' : 'POST' });
            reload();
        } catch (err) {
            setError(err);
        }
    };

    return (
        <div className="flex flex-col md:flex-row flex-1 h-full animate-fade-in-up">
            {/* 左侧联系人列表 */}
            <div className="w-full md:w-[300px] bg-[#fcfcfd] border-b md:border-b-0 md:border-r border-gray-200 flex flex-col max-h-[240px] md:max-h-none">
                <div className="p-5 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-[#1f2937]">{title}</h2>
                </div>
                <div className="overflow-y-auto flex-1">
                    {loading && <LoadingBlock />}
                    {!loading && conversations.length === 0 && <p className="p-6 text-sm text-gray-400 font-bold text-center">No inquiries yet.</p>}
                    {conversations.map(contact => {
                        const isActive = contact.id === activeId;
                        return (
                            <div
                                key={contact.id}
                                onClick={() => setActiveId(contact.id)}
                                onKeyDown={(e) => { if (e.key === 'Enter') setActiveId(contact.id); }}
                                tabIndex={0}
                                role="button"
                                className={`p-4 border-b border-gray-100 cursor-pointer flex items-center gap-3 transition-colors ${isActive ? 'bg-[#f0f4f8] border-l-4 border-l-[#1d4ed8]' : 'hover:bg-gray-50 border-l-4 border-l-transparent'}`}
                            >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${isActive ? 'bg-[#1d4ed8] text-white' : 'bg-[#e2e8f0] text-gray-600'}`}>
                                    {contactAvatar(contact)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-center mb-0.5">
                                        <h3 className={`font-bold text-[13px] truncate ${isActive ? 'text-[#1d4ed8]' : 'text-gray-800'}`}>{contactName(contact)}</h3>
                                        {contact.unread > 0 && <span className="bg-[#e11d48] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{contact.unread}</span>}
                                    </div>
                                    <p className="text-[11px] text-gray-500 truncate">RE: {contactSubject(contact)}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 右侧对话框 */}
            <div className="flex-1 flex flex-col bg-white min-h-[460px] md:min-h-0">
                {!active ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400 font-bold text-sm">Select a conversation.</div>
                ) : (
                <>
                <div className="p-5 border-b border-gray-200 flex flex-wrap gap-3 justify-between items-center shadow-sm z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#eff6ff] text-[#1d4ed8] rounded-full flex items-center justify-center font-bold">{contactAvatar(active)}</div>
                        <div>
                            <h3 className="font-bold text-[#0f172a] text-[15px]">{contactName(active)}</h3>
                            <p className="text-[11px] text-gray-500 font-medium">
                                {active.type === 'SUPPORT' && !asAdmin ? 'System' : active.other?.role === 'LANDLORD' ? (active.other.verified ? 'Verified Landlord' : 'Landlord') : active.other?.verified ? 'Verified Student' : 'Student'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {active.type !== 'SUPPORT' && active.other && !asAdmin && (
                            <>
                                <button onClick={() => setReporting(true)} className="text-[11px] font-bold text-gray-400 hover:text-[#e11d48] cursor-pointer">Report</button>
                                <button onClick={toggleBlock} className="text-[11px] font-bold text-gray-400 hover:text-[#e11d48] cursor-pointer">{active.blocked ? 'Unblock' : 'Block'}</button>
                            </>
                        )}
                        <span className="text-xs bg-gray-100 text-gray-600 font-bold px-3 py-1.5 rounded-md border border-gray-200">
                            Inquiry: {contactSubject(active)}
                        </span>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-[#f8f9fa]" aria-live="polite">
                    {messages.map(msg => (
                        <div key={msg.id} className={`flex ${msg.mine ? 'justify-end' : 'justify-start'}`}>
                            <div className="max-w-[85%] sm:max-w-[70%]">
                                <div className={`p-4 rounded-2xl ${msg.mine ? 'bg-[#0f172a] text-white rounded-tr-none shadow-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'}`}>
                                    <p className="text-[13px] leading-relaxed whitespace-pre-line break-words">{msg.body}</p>
                                </div>
                                <p className={`text-[10px] text-gray-400 mt-1.5 font-medium ${msg.mine ? 'text-right' : 'text-left'}`}>
                                    {chatTime(msg.createdAt)} {msg.mine && '✓'}
                                </p>
                            </div>
                        </div>
                    ))}
                    {typingName && (
                        <p className="text-[11px] text-gray-400 italic font-medium px-1" aria-live="polite">{typingName} is typing…</p>
                    )}
                    <div ref={bottomRef}></div>
                </div>
                <div className="p-4 border-t border-gray-200 bg-white">
                    <ErrorBanner error={error} className="mb-3" />
                    {active.blocked ? (
                        <p className="text-center text-sm text-gray-400 font-bold py-2">Messaging is disabled because one of you has blocked the other.</p>
                    ) : (
                    <form onSubmit={handleSendMessage} className="flex gap-3">
                        <input type="text" aria-label="Reply" maxLength={2000} value={newMessage} onChange={(e) => { setNewMessage(e.target.value); notifyTyping(); }} placeholder={`Reply to ${contactName(active).split(' ')[0]}...`} className="flex-1 min-w-0 bg-[#f4f7fb] border border-[#e0e7ff] rounded-full px-5 py-2.5 text-[13px] outline-none focus:border-[#1d4ed8] transition-colors" />
                        <button type="submit" aria-label="Send" disabled={!newMessage.trim()} className="bg-[#1d4ed8] text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-blue-800 transition disabled:opacity-50 cursor-pointer flex-shrink-0">
                            <span className="transform rotate-45 -mt-0.5 ml-0.5 text-sm">✈</span>
                        </button>
                    </form>
                    )}
                </div>
                </>
                )}
            </div>

            {reporting && active?.other && <ReportDialog targetType="USER" targetId={active.other.id} label={active.other.name} onClose={() => setReporting(false)} />}
        </div>
    );
};

export default Messages;
