import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const POLL_MS = 5000;

/**
 * Loads the user's conversations and the messages of the selected one,
 * polling every few seconds so new messages appear without refreshing.
 */
export function useConversations({ initialId = null, filter } = {}) {
    const { refresh } = useAuth();
    const [conversations, setConversations] = useState([]);
    const [activeId, setActiveId] = useState(initialId);
    const [messagesById, setMessagesById] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const activeRef = useRef(activeId);
    const filterRef = useRef(filter);
    useEffect(() => { activeRef.current = activeId; }, [activeId]);
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

    useEffect(() => {
        const t = setInterval(() => {
            loadConversations();
            if (activeRef.current) loadMessages(activeRef.current);
        }, POLL_MS);
        return () => clearInterval(t);
    }, [loadConversations, loadMessages]);

    const send = async (body) => {
        const msg = await api(`/conversations/${activeId}/messages`, { method: 'POST', body: { body } });
        setMessagesById((all) => ({ ...all, [activeId]: [...(all[activeId] || []), msg] }));
        setConversations((list) => list.map((c) => (c.id === activeId ? { ...c, lastMessage: msg, updatedAt: msg.createdAt } : c)));
        return msg;
    };

    const active = conversations.find((c) => c.id === activeId) || null;
    const messages = messagesById[activeId] || [];
    return { conversations, active, activeId, setActiveId, messages, send, loading, error, reload: loadConversations };
}
