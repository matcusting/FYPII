import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, timeAgo } from '../lib/api';
import { useAuth } from '../context/AuthContext';

/** Bell icon with a dropdown of in-app notifications. `dark` = for dark headers. */
const NotificationBell = ({ dark = false }) => {
    const navigate = useNavigate();
    const { unreadNotifications, refresh } = useAuth();
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState([]);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        api('/notifications').then(setItems).catch(() => {});
        const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const openItem = async (n) => {
        if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
        setOpen(false);
        refresh();
        if (n.link) navigate(n.link);
    };

    const readAll = async () => {
        await api('/notifications/read-all', { method: 'POST' }).catch(() => {});
        setItems(items.map((i) => ({ ...i, readAt: i.readAt || new Date().toISOString() })));
        refresh();
    };

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(!open)}
                aria-label={`Notifications${unreadNotifications ? ` (${unreadNotifications} unread)` : ''}`}
                aria-expanded={open}
                className={`text-sm font-bold transition-colors flex items-center gap-1.5 relative cursor-pointer ${dark ? 'text-gray-300 hover:text-white' : 'text-gray-500 hover:text-[#203569]'}`}
            >
                <span className="text-lg">🔔</span>
                {unreadNotifications > 0 && (
                    <span className="absolute -top-1.5 -right-2 bg-[#e11d48] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white shadow-sm">
                        {unreadNotifications}
                    </span>
                )}
            </button>
            {open && (
                <div className="absolute right-0 mt-3 w-[320px] max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden z-50 text-left">
                    <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
                        <span className="font-bold text-[#1f2937] text-sm">Notifications</span>
                        <button onClick={readAll} className="text-[11px] font-bold text-[#1d4ed8] hover:underline cursor-pointer">Mark all as read</button>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto">
                        {items.length === 0 && <p className="p-6 text-center text-sm text-gray-400 font-bold">No notifications yet.</p>}
                        {items.map((n) => (
                            <button key={n.id} onClick={() => openItem(n)} className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition cursor-pointer ${n.readAt ? '' : 'bg-[#f0f4f8]'}`}>
                                <p className="text-[13px] font-bold text-gray-800">{n.title}</p>
                                <p className="text-[12px] text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                                <p className="text-[11px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
