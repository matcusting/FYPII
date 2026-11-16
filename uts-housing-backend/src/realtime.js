import { Server } from 'socket.io';
import { prisma } from './db.js';
import { config } from './config.js';
import { sha256 } from './utils/crypto.js';
import { SESSION_COOKIE } from './middleware/auth.js';

/**
 * Real-time layer (WebSocket via Socket.IO).
 *
 * Replaces the earlier 5-second polling for chat (report §5.3 future work):
 *  - The browser connects with its normal HttpOnly session cookie; the same
 *    session checks as the REST API are applied (unexpired, unrevoked, not suspended).
 *  - Only the configured frontend origin may connect (same rule as CORS).
 *  - Each socket joins a private room `user:<id>`; the server pushes new
 *    messages, typing indicators and notifications only to the participants.
 *  - Clients never send messages over the socket: messages are still created
 *    through the validated, rate-limited REST endpoint, then broadcast here.
 * Transport security is provided by HTTPS/WSS in production.
 */

let io = null;

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name && v.join('=')) return decodeURIComponent(v.join('='));
  }
  return null;
}

async function userFromHandshake(handshake) {
  const token = readCookie(handshake.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.status === 'SUSPENDED') return null;
  return { user: session.user, sessionId: session.id };
}

const room = (userId) => `user:${userId}`;

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.frontendOrigin, credentials: true },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const auth = await userFromHandshake(socket.handshake);
      if (!auth) return next(new Error('UNAUTHENTICATED'));
      socket.data.user = { id: auth.user.id, name: auth.user.name };
      socket.data.sessionId = auth.sessionId;
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.user;
    socket.join(room(me.id));
    socket.join(`session:${socket.data.sessionId}`);

    // Typing indicator: relayed only if the sender takes part in the conversation.
    socket.on('typing', async (payload) => {
      const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : null;
      if (!conversationId || !/^[0-9a-f-]{36}$/i.test(conversationId)) return;
      const parts = await prisma.conversationParticipant
        .findMany({ where: { conversationId }, select: { userId: true } })
        .catch(() => []);
      if (!parts.some((p) => p.userId === me.id)) return;
      for (const p of parts) {
        if (p.userId !== me.id) io.to(room(p.userId)).emit('typing', { conversationId, name: me.name });
      }
    });
  });

  return io;
}

/** Push an event to every open tab of a user. No-op when the socket server is not running (tests, scripts). */
export function emitToUser(userId, event, payload) {
  if (io) io.to(room(userId)).emit(event, payload);
}

/** Disconnect sockets belonging to a revoked session (logout). */
export function disconnectSession(sessionId) {
  if (io && sessionId) io.in(`session:${sessionId}`).disconnectSockets(true);
}

/** Disconnect every socket of a user (logout everywhere, suspension, password reset). */
export function disconnectUser(userId) {
  if (io) io.in(room(userId)).disconnectSockets(true);
}

export async function closeRealtime() {
  if (io) await io.close();
  io = null;
}
