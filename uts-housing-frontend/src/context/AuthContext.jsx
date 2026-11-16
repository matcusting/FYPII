import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';

const AuthContext = createContext(null);
const EMPTY = { user: null, verification: null, unreadMessages: 0, unreadNotifications: 0 };

export function AuthProvider({ children }) {
    const [state, setState] = useState(EMPTY);
    const [loading, setLoading] = useState(true);
    const [socket, setSocket] = useState(null);
    const [connected, setConnected] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const me = await api('/auth/me');
            setState(me);
            return me.user;
        } catch {
            setState(EMPTY);
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    // 首次加载：恢复登录状态
    useEffect(() => {
        api('/auth/me')
            .then(setState)
            .catch(() => setState(EMPTY))
            .finally(() => setLoading(false));
    }, []);

    // Real-time connection while logged in: new messages and notifications arrive instantly.
    const userId = state.user?.id;
    useEffect(() => {
        if (!userId) return undefined;
        const s = connectSocket();
        // eslint-disable-next-line react-hooks/set-state-in-effect -- expose the socket created for this login
        setSocket(s);
        const onConnect = () => { setConnected(true); refresh(); }; // catch up on anything missed while offline
        const onDisconnect = () => setConnected(false);
        const onMessage = ({ message }) => {
            if (!message.mine) setState((st) => ({ ...st, unreadMessages: st.unreadMessages + 1 }));
        };
        const onNotification = () => setState((st) => ({ ...st, unreadNotifications: st.unreadNotifications + 1 }));
        s.on('connect', onConnect);
        s.on('disconnect', onDisconnect);
        s.on('message:new', onMessage);
        s.on('notification:new', onNotification);
        if (s.connected) setConnected(true);
        return () => {
            s.off('connect', onConnect);
            s.off('disconnect', onDisconnect);
            s.off('message:new', onMessage);
            s.off('notification:new', onNotification);
            disconnectSocket();
            setSocket(null);
            setConnected(false);
        };
    }, [userId, refresh]);

    // Fallback refresh in case the socket is blocked (e.g. a strict proxy); much rarer than before.
    useEffect(() => {
        if (!state.user) return undefined;
        const t = setInterval(refresh, connected ? 120000 : 30000);
        return () => clearInterval(t);
    }, [state.user, refresh, connected]);

    const login = async (payload) => {
        const { user } = await api('/auth/login', { method: 'POST', body: payload });
        await refresh();
        return user;
    };

    const register = async (payload) => {
        const { user } = await api('/auth/register', { method: 'POST', body: payload });
        await refresh();
        return user;
    };

    const logout = async () => {
        try {
            await api('/auth/logout', { method: 'POST' });
        } finally {
            disconnectSocket();
            setState(EMPTY);
        }
    };

    return (
        <AuthContext.Provider value={{ ...state, loading, refresh, login, register, logout, socket, connected }}>
            {children}
        </AuthContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
