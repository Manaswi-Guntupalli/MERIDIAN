import 'package:socket_io_client/socket_io_client.dart' as io;

import '../config/env.dart';

/// The Socket.io connection, mirroring the web's `lib/socket.ts`.
///
/// The server derives the school and user rooms from our JWT (see
/// `server/src/lib/socket.ts`) — the client never asks to join one, so a
/// device cannot eavesdrop on another tenant.
class SocketClient {
  SocketClient();

  io.Socket? _socket;

  bool get isConnected => _socket?.connected ?? false;

  /// Opens the connection with the bearer token, or returns the existing one.
  /// Reconnection is left to socket.io's own backoff — a phone changing
  /// networks should recover without the app orchestrating it.
  io.Socket connect(String token) {
    final existing = _socket;
    if (existing != null) return existing;

    final socket = io.io(
      Env.socketUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .enableReconnection()
          .enableForceNew()
          .build(),
    );
    _socket = socket;
    return socket;
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }
}
