'use client';

import { useEffect, useRef, useState } from 'react';
import { getAccess, isAuthed, refreshAccessToken } from '@/lib/api';
import type { ChannelStatus } from '@/lib/channelSocket';

function httpBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';
}

/** Account-level realtime event. Not scoped to a matter room. */
export interface UserEvent {
  type: 'notification' | 'consultation.created' | string;
  kind?: string;
  id?: number;
  title?: string;
  consultation_id?: number;
  matter_id?: number;
}

/**
 * Subscribe to the signed-in user's own realtime feed over Server-Sent Events.
 * Same transport and reconnect behaviour as useChannelEvents, but the topic is
 * the account rather than a channel — it carries events with no matter room to
 * ride on, like a booking that has only just created its room.
 */
export function useUserEvents(onEvent: (event: UserEvent) => void): ChannelStatus {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [status, setStatus] = useState<ChannelStatus>('connecting');

  useEffect(() => {
    if (!isAuthed()) {
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
      const url = `${httpBase()}/api/v1/me/events/?token=${encodeURIComponent(token)}`;
      source = new EventSource(url);

      source.onopen = () => {
        attempt = 0;
        setStatus('connected');
      };
      source.onmessage = (e) => {
        try {
          onEventRef.current(JSON.parse(e.data) as UserEvent);
        } catch {}
      };
      source.onerror = () => {
        // A non-2xx (e.g. 401 from an expired token) closes the EventSource
        // permanently — refresh and reconnect ourselves. A mid-stream drop
        // leaves it CONNECTING and the browser retries on its own.
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
  }, []);

  return status;
}
