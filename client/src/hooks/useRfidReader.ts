import { useCallback, useEffect, useRef, useState } from 'react';

// Reads real RFID hardware. Covers the two common reader types:
//
//  - USB "keyboard wedge" readers — by far the cheapest and most common kind:
//    the reader enumerates as a USB keyboard and types the tag ID followed by
//    Enter. We capture that by keeping a hidden input focused while armed and
//    reading its value on submit. No drivers or browser permissions needed.
//
//  - USB/TTL serial readers (e.g. RDM6300-style modules wired through a
//    serial adapter) — read via the Web Serial API (Chrome/Edge only), one
//    tag ID per line.
//
// Both paths funnel into the same `onScan(tag)` callback.
export function useRfidReader(onScan: (tag: string) => void) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [lastTag, setLastTag] = useState<string | null>(null);

  // Always call the latest onScan without re-wiring listeners every render.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const emit = useCallback((raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    setLastTag(tag);
    onScanRef.current(tag);
  }, []);

  // Keyboard-wedge capture: keep the hidden input focused while armed so the
  // reader's keystrokes land there instead of wherever the cursor happens to
  // be. We back off if the user is actively using another field/select.
  useEffect(() => {
    if (!armed) return;
    const el = inputRef.current;
    el?.focus();
    const refocus = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) return;
      el?.focus();
    };
    const interval = setInterval(refocus, 400);
    document.addEventListener('click', refocus);
    return () => {
      clearInterval(interval);
      document.removeEventListener('click', refocus);
    };
  }, [armed]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        emit(e.currentTarget.value);
        e.currentTarget.value = '';
      }
    },
    [emit],
  );

  // ── Optional: raw serial readers via the Web Serial API ──
  const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;
  const [serialConnected, setSerialConnected] = useState(false);
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);

  const disconnectSerial = useCallback(async () => {
    try {
      await readerRef.current?.cancel();
    } catch {
      /* already stopped */
    }
    try {
      await portRef.current?.close();
    } catch {
      /* already closed */
    }
    readerRef.current = null;
    portRef.current = null;
    setSerialConnected(false);
  }, []);

  const connectSerial = useCallback(
    async (baudRate = 9600) => {
      if (!serialSupported) return;
      try {
        const port = await (navigator as any).serial.requestPort();
        await port.open({ baudRate });
        portRef.current = port;
        setSerialConnected(true);

        const reader = port.readable.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';

        (async () => {
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let idx: number;
              while ((idx = buffer.search(/[\r\n]/)) >= 0) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                if (line) emit(line);
              }
            }
          } catch {
            /* port closed / disconnected */
          } finally {
            setSerialConnected(false);
          }
        })();
      } catch {
        /* user cancelled the device picker, or the port failed to open */
      }
    },
    [emit, serialSupported],
  );

  useEffect(() => () => void disconnectSerial(), [disconnectSerial]);

  return { inputRef, armed, setArmed, lastTag, handleKeyDown, serialSupported, serialConnected, connectSerial, disconnectSerial };
}
