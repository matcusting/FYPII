import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);
const EMPTY = { user: null, verification: null, unreadMessages: 0, unreadNotifications: 0 };

export function AuthProvider({ children }) {
    const [state, setState] = useState({ user: null, verification: null, unreadMessages: 0, unreadNotifications: 0 });
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const me = await api('/auth/me');
            setState(me);
            return me.user;
        } catch {
            setState({ user: null, verification: null, unreadMessages: 0, unreadNotifications: 0 });
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

    // Keep unread badges fresh while logged in.
    useEffect(() => {
        if (!state.user) return undefined;
        const t = setInterval(refresh, 30000);
        return () => clearInterval(t);
    }, [state.user, refresh]);

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
            setState({ user: null, verification: null, unreadMessages: 0, unreadNotifications: 0 });
        }
    };

    return (
        <AuthContext.Provider value={{ ...state, loading, refresh, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
