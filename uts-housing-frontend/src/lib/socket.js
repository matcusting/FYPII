// Real-time connection to the API (Socket.IO over WebSocket).
// The HttpOnly session cookie authenticates the socket, exactly like REST calls.
import { io } from 'socket.io-client';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

let socket = null;

/** Open (or reuse) the socket for the logged-in user. */
export function connectSocket() {
    if (socket) return socket;
    // Empty origin = same origin (Vite proxies /socket.io to the API in development).
    socket = io(API_ORIGIN || undefined, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
        reconnectionDelayMax: 10000,
    });
    return socket;
}

export function disconnectSocket() {
    if (socket) socket.disconnect();
    socket = null;
}

export const getSocket = () => socket;
