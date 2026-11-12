import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { useConversations } from '../../hooks/useConversations';
import { api, assetUrl, chatTime } from '../../lib/api';
import { ErrorBanner, LoadingBlock, ReportDialog } from '../../components/ui';

// 联系人显示名称与身份
const contactName = (c) => (c.type === 'SUPPORT' ? 'Admin Support' : c.other?.name || 'Deleted user');
const contactAvatar = (c) => (c.type === 'SUPPORT' ? 'S' : c.other?.initials || '?');
const contactRole = (c) => {
    if (c.type === 'SUPPORT') return 'System';
    if (c.type === 'ROOMMATE') return 'Student (Roommate Match)';
    return `${c.other?.verified ? 'Verified Landlord' : 'Landlord'}${c.listing ? ` • ${c.listing.title}` : ''}`;
};

const Messages = () => {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { conversations, active, activeId, setActiveId, messages, send, loading, error, reload } = useConversations({ initialId: params.get('c') });
    const [newMessage, setNewMessage] = useState('');
    const [sendError, setSendError] = useState(null);
    const [sending, setSending] = useState(false);
    const [reporting, setReporting] = useState(false);
    const bottomRef = useRef(null);

    // 控制 View Property 弹窗显示的状态
    const [showPropertyModal, setShowPropertyModal] = useState(false);

    // 确保"Admin Support"对话存在（与原设计保持一致）
    useEffect(() => {
        api('/conversations/support', { method: 'POST' }).then(reload).catch(() => {});
    }, [reload]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: 'end' });
    }, [messages.length, activeId]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;
        setSending(true);
        setSendError(null);
        try {
            await send(newMessage.trim());
            setNewMessage('');
        } catch (err) {
            setSendError(err);
        } finally {
            setSending(false);
        }
    };

    const toggleBlock = async () => {
        if (!active?.other) return;
        if (!active.blocked && !window.confirm(`Block ${active.other.name}? Neither of you will be able to send messages.`)) return;
        try {
            await api(`/blocks/${active.other.id}`, { method: active.blocked ? 'DELETE' : 'POST' });
            reload();
        } catch (err) {
            setSendError(err);
        }
    };

    const property = active?.listing;

    return (
        <div className="min-h-screen bg-[#f8f9fa] pb-20 font-sans relative">
            <Navbar />

            <div className="max-w-[1000px] w-[calc(100%-2rem)] mx-auto mb-4">
                <button onClick={() => navigate('/student')} className="text-gray-500 hover:text-gray-800 font-bold text-sm flex items-center gap-1 transition-colors cursor-pointer">
                    ← Back to Dashboard
                </button>
            </div>

            <div className="max-w-[1000px] w-[calc(100%-2rem)] mx-auto bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)] rounded-xl overflow-hidden border border-gray-100 flex flex-col md:flex-row md:h-[650px]">

                {/* 左侧：联系人列表 */}
                <div className="w-full md:w-[320px] bg-[#fcfcfd] border-b md:border-b-0 md:border-r border-gray-200 flex flex-col max-h-[260px] md:max-h-none">
                    <div className="p-6 border-b border-gray-200 bg-white">
                        <h2 className="text-xl font-bold text-[#1f2937]">Messages</h2>
                    </div>

                    <div className="overflow-y-auto flex-1">
                        {loading && <LoadingBlock />}
                        {!loading && conversations.length === 0 && (
                            <p className="p-6 text-sm text-gray-400 font-bold text-center">No conversations yet. Contact a landlord from a listing or connect with a roommate.</p>
                        )}
                        {conversations.map(contact => {
                            const isActive = contact.id === activeId;
                            return (
                                <div
                                    key={contact.id}
                                    onClick={() => setActiveId(contact.id)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') setActiveId(contact.id); }}
                                    tabIndex={0}
                                    role="button"
                                    className={`p-4 border-b border-gray-100 cursor-pointer flex items-center gap-4 transition-colors ${isActive ? 'bg-[#f0f4f8] border-l-4 border-l-[#203569]' : 'hover:bg-gray-50 border-l-4 border-l-transparent'}`}
                                >
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg transition-colors flex-shrink-0 ${isActive ? 'bg-[#203569] text-white' : 'bg-[#e2e8f0] text-gray-600'}`}>
                                        {contactAvatar(contact)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center mb-1">
                                            <h3 className={`font-bold truncate ${isActive ? 'text-[#203569]' : 'text-gray-800'}`}>{contactName(contact)}</h3>
                                            {contact.unread > 0 && (
                                                <span className="bg-[#e11d48] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                                    {contact.unread}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[12px] text-gray-500 truncate">{contactRole(contact)}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 右侧：聊天对话框 */}
                <div className="flex-1 flex flex-col bg-white min-h-[500px] md:min-h-0">
                    {!active ? (
                        <div className="flex-1 flex items-center justify-center text-gray-400 font-bold text-sm p-6 text-center">
                            {error ? <ErrorBanner error={error} /> : 'Select a conversation to start chatting.'}
                        </div>
                    ) : (
                    <>
                    <div className="p-5 sm:p-6 border-b border-gray-200 flex flex-wrap gap-3 justify-between items-center bg-white shadow-sm z-10">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-[#203569] text-white rounded-full flex items-center justify-center font-bold">
                                {contactAvatar(active)}
                            </div>
                            <div>
                                <h3 className="font-bold text-[#1f2937] text-[1.1rem]">{contactName(active)}</h3>
                                <p className="text-[12px] text-[#16a34a] font-medium flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-[#16a34a] rounded-full inline-block"></span> {contactRole(active).split(' • ')[0]}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {active.type !== 'SUPPORT' && active.other && (
                                <>
                                    <button onClick={() => setReporting(true)} className="text-[12px] font-bold text-gray-400 hover:text-[#e11d48] cursor-pointer">Report</button>
                                    <button onClick={toggleBlock} className="text-[12px] font-bold text-gray-400 hover:text-[#e11d48] cursor-pointer">{active.blocked ? 'Unblock' : 'Block'}</button>
                                </>
                            )}
                            {/* View Property 按钮 */}
                            {property && (
                                <button
                                    onClick={() => setShowPropertyModal(true)}
                                    className="text-[13px] font-bold text-[#203569] border border-[#203569] px-4 py-1.5 rounded-md hover:bg-blue-50 transition cursor-pointer"
                                >
                                    View Property
                                </button>
                            )}
                        </div>
                    </div>

                    {/* 聊天记录滚动区 */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#f8f9fa]" aria-live="polite">
                        {messages.length === 0 && <p className="text-center text-sm text-gray-400 font-bold">No messages yet — say hello!</p>}
                        {messages.map(msg => (
                            <div key={msg.id} className={`flex ${msg.mine ? 'justify-end' : 'justify-start'}`}>
                                <div className="max-w-[85%] sm:max-w-[70%]">
                                    <div className={`p-4 rounded-2xl ${msg.mine ? 'bg-[#203569] text-white rounded-tr-none shadow-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'}`}>
                                        <p className="text-[14px] leading-relaxed whitespace-pre-line break-words">{msg.body}</p>
                                    </div>
                                    <p className={`text-[11px] text-gray-400 mt-1.5 font-medium ${msg.mine ? 'text-right' : 'text-left'}`}>
                                        {chatTime(msg.createdAt)} {msg.mine && '✓'}
                                    </p>
                                </div>
                            </div>
                        ))}
                        <div ref={bottomRef}></div>
                    </div>

                    {/* 输入框区域 */}
                    <div className="p-4 border-t border-gray-200 bg-white">
                        <ErrorBanner error={sendError} className="mb-3" />
                        {active.blocked ? (
                            <p className="text-center text-sm text-gray-400 font-bold py-3">Messaging is disabled because one of you has blocked the other.</p>
                        ) : (
                        <form onSubmit={handleSendMessage} className="flex gap-3">
                            <input
                                type="text"
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                placeholder="Type your message here..."
                                aria-label="Message"
                                maxLength={2000}
                                className="flex-1 min-w-0 bg-[#f4f7fb] border border-[#e0e7ff] rounded-full px-6 py-3 text-[14px] outline-none focus:border-[#203569] focus:bg-white transition-colors"
                            />
                            <button
                                type="submit"
                                aria-label="Send"
                                disabled={!newMessage.trim() || sending}
                                className="bg-[#203569] text-white w-12 h-12 rounded-full flex items-center justify-center hover:bg-[#1a2b56] transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex-shrink-0"
                            >
                                <span className="transform rotate-45 -mt-1 ml-1 text-lg">✈</span>
                            </button>
                        </form>
                        )}
                    </div>
                    </>
                    )}
                </div>
            </div>

            {/* --- 点击 View Property 弹出的房源详情窗口 --- */}
            {showPropertyModal && property && (
                <div
                    onClick={() => setShowPropertyModal(false)}
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-[600px] max-h-[92vh] overflow-y-auto border border-gray-100"
                    >
                        <div className="h-[200px] bg-[#cbd5e1] relative flex items-center justify-center overflow-hidden">
                            {property.photos[0] ? (
                                <img src={assetUrl(property.photos[0].url)} alt={property.title} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-gray-500 font-bold text-lg">Property Image Gallery</span>
                            )}
                            <button
                                onClick={() => setShowPropertyModal(false)}
                                aria-label="Close"
                                className="absolute top-4 right-4 w-9 h-9 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center font-bold text-xl transition cursor-pointer"
                            >
                                ×
                            </button>
                            <span className="absolute bottom-4 left-6 bg-[#203569] text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-sm">
                                {property.roomType}
                            </span>
                        </div>

                        <div className="p-6 sm:p-8">
                            <div className="flex flex-col sm:flex-row gap-3 justify-between items-start border-b border-gray-100 pb-5 mb-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-[#1f2937]">{property.title}</h2>
                                    <p className="text-sm text-gray-500 mt-1 flex flex-wrap items-center gap-2">
                                        <span>Landlord: <strong className="text-gray-800">{property.landlord.name}</strong></span>
                                        {property.landlord.verified && <span className="bg-[#dcfce7] text-[#15803d] text-[10px] font-bold px-2 py-0.5 rounded">✓ Verified</span>}
                                        <span>• {property.distanceKm} km to UTS</span>
                                    </p>
                                    {property.status !== 'PUBLISHED' && <p className="text-[12px] text-[#a16207] font-bold mt-1">This listing is no longer active.</p>}
                                </div>
                                <div className="sm:text-right">
                                    <div className="text-2xl font-bold text-[#16a34a]">RM {property.rent}<span className="text-sm text-gray-500 font-normal">/mo</span></div>
                                    <div className="text-xs text-gray-400 font-medium mt-0.5">Deposit: RM {property.deposit}</div>
                                </div>
                            </div>

                            {property.address && (
                                <a
                                    href={property.googleMapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mb-6 flex items-start gap-3 border border-gray-200 rounded-xl px-4 py-3 hover:border-[#203569] hover:bg-[#f4f7fb] transition group"
                                >
                                    <span className="text-xl leading-none mt-0.5">📍</span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider">Address</span>
                                        <span className="block text-sm font-bold text-[#203569] group-hover:underline break-words">{property.address}</span>
                                    </span>
                                    <span className="text-[12px] font-bold text-[#1d4ed8] whitespace-nowrap self-center">Open in Google Maps ↗</span>
                                </a>
                            )}

                            <div className="mb-6">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">About this property</h4>
                                <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">
                                    {property.description || 'No description provided.'}
                                </p>
                            </div>

                            <div className="mb-8">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Included Facilities</h4>
                                <div className="flex flex-wrap gap-2">
                                    {property.facilities.map((fac, idx) => (
                                        <span key={idx} className="bg-[#f0f4f8] text-[#203569] text-xs font-bold px-3.5 py-1.5 rounded-full">
                                            ✓ {fac}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-gray-100">
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

            {reporting && active?.other && <ReportDialog targetType="USER" targetId={active.other.id} label={active.other.name} onClose={() => setReporting(false)} />}
        </div>
    );
};

export default Messages;
