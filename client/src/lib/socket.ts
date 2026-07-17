import { io, type Socket } from 'socket.io-client';
import { TOKEN_KEY } from './api';

let socket: Socket | null = null;

// The server derives the school room from our JWT — we never ask to join one.
export function connectSocket(): Socket | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  if (socket) return socket;
  socket = io('/', { transports: ['websocket', 'polling'], auth: { token } });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}
