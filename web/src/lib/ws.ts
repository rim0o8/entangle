import { useEffect, useRef, useState } from 'react';

export interface WireEvent {
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export function useDemoEvents(port = 8787): WireEvent[] {
  const [events, setEvents] = useState<WireEvent[]>([]);
  const portRef = useRef(port);
  portRef.current = port;

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = (): void => {
      if (cancelled) return;
      try {
        ws = new WebSocket(`ws://localhost:${portRef.current}`);
      } catch {
        scheduleReconnect();
        return;
      }
      ws.addEventListener('message', (msg) => {
        try {
          const parsed = JSON.parse(String(msg.data)) as WireEvent;
          setEvents((prev) => [...prev, parsed]);
        } catch {
          // ignore malformed
        }
      });
      ws.addEventListener('close', () => {
        scheduleReconnect();
      });
      ws.addEventListener('error', () => {
        try {
          ws?.close();
        } catch {
          // ignore
        }
      });
    };

    const scheduleReconnect = (): void => {
      if (cancelled) return;
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1000);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  return events;
}
