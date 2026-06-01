/* Tiny pub/sub for the lawyer's currently-running TimeEntry. Used by both the
 * dashboard TimeTracker card and the in-matter TimerWidget so they stay in
 * sync without bouncing through the API. */

import { useEffect, useState } from 'react';
import { timeEntries as timeApi, type TimeEntry } from '@/lib/api';

type Listener = (entry: TimeEntry | null) => void;

let current: TimeEntry | null = null;
let initialized = false;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(current);
}

export function getRunning(): TimeEntry | null {
  return current;
}

export function setRunning(entry: TimeEntry | null) {
  current = entry;
  emit();
}

export function subscribeRunning(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function refreshOnce() {
  try {
    const entry = await timeApi.running();
    current = entry ?? null;
  } catch {
    current = null;
  } finally {
    emit();
  }
}

/** Hook — returns the currently running TimeEntry (or null) and stays subscribed. */
export function useRunningTimer(): TimeEntry | null {
  const [state, setState] = useState<TimeEntry | null>(current);
  useEffect(() => {
    if (!initialized) {
      initialized = true;
      void refreshOnce();
    }
    const unsubscribe = subscribeRunning(setState);
    return () => {
      unsubscribe();
    };
  }, []);
  return state;
}
