'use client';

import { useEffect } from 'react';

/** Fires the callback when the user presses Escape (typically to close a modal). */
export function useEscape(onEscape: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEscape]);
}
