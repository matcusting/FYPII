import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const FALLBACK_POLL_MS = 15000; // only used while the real-time connection is down
const TYPING_SHOW_MS = 3000;
const TYPING_SEND_MS = 2000;

/**
 * Loads the user's conversations and the messages of the selected one.
 * New messages and typing indicators arrive in real time over the WebSocket;
 * if the socket is disconnected the hook falls back to polling.
 */
export function useConversations({ initialId = null, filter } = {}) {
    const { refresh, socket, connected } = useAuth();
    const [conversations, setConversations] = useState([]);
    const [activeId, setActiveId] = useState(initialId);
    const [messagesById, setMessagesById] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [typing, setTyping] = useState({}); // conversationId -> { name, until }
    const activeRef = useRef(activeId);
    const filterRef = useRef(filter);
    const lastTypingSent = useRef(0);
    const knownIds = useRef(new Set());
    useEffect(() => { activeRef.current = activeId; }, [activeId]);
    useEffect(() => { knownIds.current = new Set(conversations.map((c) => c.id)); }, [conversations]);
    useEffect(() => { filterRef.current = filter; }, [filter]);

    const loadConversations = useCallback(async () => {
        try {
            let list = await api('/conversations');
            if (filterRef.current) list = list.filter(filterRef.current);
            setConversations(list);
            setActiveId((cur) => cur || list[0]?.id || null);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadMessages = useCallback(async (id) => {
        if (!id) return;
        try {
            const msgs = await api(`/conversations/${id}/messages`);
            setMessagesById((all) => ({ ...all, [id]: msgs }));
            setConversations((list) => list.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
        } catch (err) {
            setError(err);
        }
    }, []);

    useEffect(() => { loadConversations(); }, [loadConversations]);

    // 切换对话时立即加载消息并标记为已读
    useEffect(() => {
        if (!activeId) return;
        api(`/conversations/${activeId}/messages`)
            .then((msgs) => {
                setMessagesById((all) => ({ ...all, [activeId]: msgs }));
                setConversations((list) => list.map((c) => (c.id === activeId ? { ...c, unread: 0 } : c)));
                refresh();
            })
            .catch(setError);
    }, [activeId, refresh]);

    // Real-time events
    useEffect(() => {
        if (!socket) return undefined;
        const onMessage = ({ conversationId, message }) => {
            // A brand-new conversation (e.g. a first inquiry about a listing): reload the list.
            if (!knownIds.current.has(conversationId)) {
                knownIds.current.add(conversationId);
                loadConversations();
                return;
            }
            setConversations((list) => {
                const isOpen = conversationId === activeRef.current;
                return list
                    .map((c) => (c.id === conversationId
                        ? { ...c, lastMessage: message, updatedAt: message.createdAt, unread: isOpen || message.mine ? 0 : c.unread + 1 }
                        : c))
                    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            });
            setMessagesById((all) => {
                const current = all[conversationId];
                if (!current || current.some((m) => m.id === message.id)) return all; // not loaded yet, or already shown
                return { ...all, [conversationId]: [...current, message] };
            });
            setTyping((t) => { const rest = { ...t }; delete rest[conversationId]; return rest; });
            if (conversationId === activeRef.current && !message.mine) {
                // Mark as read on the server (the GET does that) without re-rendering the whole list.
                api(`/conversations/${conversationId}/messages`).then(() => refresh()).catch(() => {});
            }
        };
        const onTyping = ({ conversationId, name }) => {
            setTyping((t) => ({ ...t, [conversationId]: { name, until: Date.now() + TYPING_SHOW_MS } }));
        };
        socket.on('message:new', onMessage);
        socket.on('typing', onTyping);
        return () => {
            socket.off('message:new', onMessage);
            socket.off('typing', onTyping);
        };
    }, [socket, loadConversations, refresh]);

    // Expire typing indicators
    useEffect(() => {
        const keys = Object.keys(typing);
        if (!keys.length) return undefined;
        const t = setTimeout(() => {
            const now = Date.now();
            setTyping((all) => Object.fromEntries(Object.entries(all).filter(([, v]) => v.until > now)));
        }, 1000);
        return () => clearTimeout(t);
    }, [typing]);

    // Fallback polling only while the socket is not connected; resync once it reconnects.
    useEffect(() => {
        if (connected) {
            loadConversations();
            if (activeRef.current) loadMessages(activeRef.current);
            return undefined;
        }
        const t = setInterval(() => {
            loadConversations();
            if (activeRef.current) loadMessages(activeRef.current);
        }, FALLBACK_POLL_MS);
        return () => clearInterval(t);
    }, [connected, loadConversations, loadMessages]);

    const send = async (body) => {
        const msg = await api(`/conversations/${activeId}/messages`, { method: 'POST', body: { body } });
        setMessagesById((all) => {
            const current = all[activeId] || [];
            if (current.some((m) => m.id === msg.id)) return all; // already arrived over the socket
            return { ...all, [activeId]: [...current, msg] };
        });
        setConversations((list) => list.map((c) => (c.id === activeId ? { ...c, lastMessage: msg, updatedAt: msg.createdAt } : c)));
        return msg;
    };

    /** Call on every keystroke; throttled so the other person sees "typing…". */
    const notifyTyping = useCallback(() => {
        if (!socket || !activeRef.current) return;
        const now = Date.now();
        if (now - lastTypingSent.current < TYPING_SEND_MS) return;
        lastTypingSent.current = now;
        socket.emit('typing', { conversationId: activeRef.current });
    }, [socket]);

    const active = conversations.find((c) => c.id === activeId) || null;
    const messages = messagesById[activeId] || [];
    const typingName = activeId ? typing[activeId]?.name || null : null;
    return { conversations, active, activeId, setActiveId, messages, send, loading, error, reload: loadConversations, typingName, notifyTyping, live: connected };
}
