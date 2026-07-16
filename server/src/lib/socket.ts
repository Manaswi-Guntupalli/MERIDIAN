import { Server as IOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { env } from '../config/env.js';

let io: IOServer | null = null;

export function initSocket(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });

  io.on('connection', (socket) => {
    // Clients join their school room to receive scoped realtime updates.
    socket.on('join', (schoolId: string) => {
      if (schoolId) socket.join(`school:${schoolId}`);
    });
  });

  return io;
}

// Broadcast a realtime event to everyone in a school. Used by the event store,
// Presence attendance kiosk, Emergency mode, notifications, etc.
export function emitToSchool(schoolId: string, event: string, payload: unknown): void {
  io?.to(`school:${schoolId}`).emit(event, payload);
}

export function getIO(): IOServer | null {
  return io;
}
