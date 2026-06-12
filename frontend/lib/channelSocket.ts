'use client';

import { useEffect, useRef, useState } from 'react';
import { getAccess } from '@/lib/api';

export type ChannelStatus = 'connecting' | 'connected' | 'disconnected';

export interface ChannelEvent {
  kind:
    | 'message.created'
    | 'message.reaction'
    | 'document.created'
    | 'document.updated'
    | 'payment.created'
    | 'payment.updated';
  message?: any;
  message_id?: number;
  reactions?: any;
  toggled?: 'added' | 'removed';
  document?: any;
  payment_id?: number;
  matter_id?: number;
}

function wsBase(): string {
  const http = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';
  return http.replace(/^http/, 'ws');
}

/** Subscribe to chat events for a channel. Returns nothing — call `onEvent`
 * to react. Auto-reconnects with exponential back-off up to 30s. */
export function useChannelSocket(
  channelId: number | null,
  onEvent: (event: ChannelEvent) => void
): ChannelStatus {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [status, setStatus] = useState<ChannelStatus>('connecting');

  useEffect(() => {
    if (!channelId) {
      setStatus('disconnected');
      return;
    }
    let socket: WebSocket | null = null;
    let attempt = 0;
    let closed = false;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (closed) return;
      setStatus('connecting');
      const token = getAccess() ?? '';
      const url = `${wsBase()}/ws/channel/${channelId}/?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempt = 0;
        setStatus('connected');
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          try {
            socket?.send(JSON.stringify({ type: 'ping' }));
          } catch {}
        }, 25_000);
      };
      socket.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload?.type === 'pong') return;
          onEventRef.current(payload as ChannelEvent);
        } catch {}
      };
      socket.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        if (closed) return;
        setStatus('disconnected');
        attempt += 1;
        const delay = Math.min(30_000, 500 * Math.pow(2, attempt));
        reconnectTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => {
        // Let onclose handle the reconnect.
        try { socket?.close(); } catch {}
      };
    }

    connect();

    return () => {
      closed = true;
      setStatus('disconnected');
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { socket?.close(); } catch {}
    };
  }, [channelId]);

  return status;
}
