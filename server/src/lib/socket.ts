import { Server as IOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { env } from '../config/env.js';
import { verifyToken } from './auth.js';

let io: IOServer | null = null;

export function initSocket(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });

  /**
   * Every socket must present a valid JWT. The school room is derived from the
   * verified token — clients can no longer ask to join an arbitrary school and
   * eavesdrop on another tenant's attendance, emergencies or AI ledger.
   */
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.slice(7)
        : undefined);
    if (!token) return next(new Error('Unauthorized: missing token'));
    try {
      const payload = verifyToken(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Unauthorized: invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { schoolId: string; sub: string } | undefined;
    if (!user) return socket.disconnect(true);
    // Server-side room assignment only.
    socket.join(`school:${user.schoolId}`);
    socket.join(`user:${user.sub}`);
  });

  return io;
}

// Broadcast a realtime event to everyone in a school.
export function emitToSchool(schoolId: string, event: string, payload: unknown): void {
  io?.to(`school:${schoolId}`).emit(event, payload);
}

// Broadcast to a single user (e.g. a parent's own notification).
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function getIO(): IOServer | null {
  return io;
}
