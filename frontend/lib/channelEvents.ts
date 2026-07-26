'use client';

import { useEffect, useRef, useState } from 'react';
import { getAccess, refreshAccessToken } from '@/lib/api';
import type { ChannelEvent, ChannelStatus } from '@/lib/channelSocket';

export type { ChannelEvent, ChannelStatus } from '@/lib/channelSocket';

function httpBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';
}

/**
 * Subscribe to a channel's realtime feed over Server-Sent Events. Drop-in
 * replacement for useChannelSocket — same signature and event shape, but plain
 * HTTP (survives proxies/LBs that drop WebSockets). Refreshes the access token
 * on an auth failure and reconnects with back-off.
 */
export function useChannelEvents(
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
    let source: EventSource | null = null;
    let closed = false;
    let attempt = 0;
    let needsRefresh = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (closed) return;
      setStatus('connecting');
      let token = getAccess() ?? '';
      if (needsRefresh) {
        needsRefresh = false;
        const fresh = await refreshAccessToken();
        if (fresh) token = fresh;
      }
      if (closed) return;
      const url = `${httpBase()}/api/v1/channels/${channelId}/events/?token=${encodeURIComponent(token)}`;
      source = new EventSource(url);

      source.onopen = () => {
        attempt = 0;
        setStatus('connected');
      };
      source.onmessage = (e) => {
        try {
          onEventRef.current(JSON.parse(e.data) as ChannelEvent);
        } catch {}
      };
      source.onerror = () => {
        // A non-2xx response (e.g. 401 from an expired token) closes the
        // EventSource permanently — refresh the token and reconnect ourselves.
        // A mid-stream drop leaves it CONNECTING (browser auto-retries).
        if (!source || source.readyState === EventSource.CLOSED) {
          if (closed) return;
          needsRefresh = true;
          try { source?.close(); } catch {}
          setStatus('disconnected');
          attempt += 1;
          const delay = Math.min(30_000, 500 * Math.pow(2, attempt));
          reconnectTimer = setTimeout(connect, delay);
        } else {
          setStatus('connecting');
        }
      };
    }

    connect();

    return () => {
      closed = true;
      setStatus('disconnected');
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { source?.close(); } catch {}
    };
  }, [channelId]);

  return status;
}
