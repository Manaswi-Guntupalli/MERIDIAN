import { useCallback, useEffect, useRef, useState } from 'react';

// Requests the webcam and wires it to a <video> ref. Cleans up the stream
// on unmount so the camera light never stays on.
export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    // Browsers deliberately refuse getUserMedia on ordinary HTTP origins.
    // `localhost` is the one development exception, which is why the kiosk
    // works at http://localhost:5173 but a phone/LAN URL such as
    // http://192.168.x.x:5173 shows Chrome's "Blocked to protect your privacy"
    // message. Say that explicitly instead of incorrectly blaming the camera.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        'Camera needs a secure page. For the laptop kiosk, open http://localhost:5173; use HTTPS for a LAN address.',
      );
      return;
    }

    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
      }
    } catch (e) {
      const name = (e as Error).name;
      const message =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Camera permission denied. In Chrome, click the camera icon beside the address bar and choose Allow, then reload.'
          : name === 'NotReadableError'
            ? 'Camera is being used by another app. Close Teams, Zoom, or Windows Camera and try again.'
            : name === 'NotFoundError'
              ? 'No camera was detected. Connect a webcam or select an available camera in Chrome settings.'
              : 'Camera could not start. Check browser camera permissions and try again.';
      setError(message);
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, ready, error, start, stop };
}
