import 'package:dio/dio.dart';

/// Turns a Dio failure into the human message the backend already wrote —
/// mirroring the web's `apiError()`. The backend's errors read like a person
/// wrote them ("Amount exceeds outstanding balance"), so we surface them as-is.
String friendlyError(Object error, [String fallback = 'Something went wrong']) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map && data['message'] is String) {
      return data['message'] as String;
    }
    if (data is Map && data['error'] is String) {
      return data['error'] as String;
    }
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
        return 'The server took too long to respond. Check your connection.';
      case DioExceptionType.connectionError:
        return "Can't reach Meridian. Make sure you're on the same network as the server.";
      default:
        return error.message ?? fallback;
    }
  }
  return error.toString().replaceFirst('Exception: ', '');
}

/// True when a request failed because the session is no longer valid.
bool isUnauthorized(Object error) =>
    error is DioException && error.response?.statusCode == 401;
