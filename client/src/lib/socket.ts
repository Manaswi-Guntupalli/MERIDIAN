import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket(schoolId: string): Socket {
  if (socket) return socket;
  socket = io('/', { transports: ['websocket', 'polling'] });
  socket.on('connect', () => socket?.emit('join', schoolId));
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}
