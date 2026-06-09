/** Tiny wrapper around the browser Notification API. Safe on SSR + opt-in. */

const PERMISSION_KEY = 'attorney.notify-permission-asked';

export function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted';
}

export async function requestPermissionOnce(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  // Only ask once per browser to avoid pestering the user across sessions.
  if (window.localStorage.getItem(PERMISSION_KEY)) return Notification.permission;
  try {
    const result = await Notification.requestPermission();
    window.localStorage.setItem(PERMISSION_KEY, '1');
    return result;
  } catch {
    return 'denied';
  }
}

export function fireNotification(title: string, opts: { body?: string; tag?: string; onClick?: () => void } = {}) {
  if (!canNotify()) return;
  // Don't pop up if the user is already looking at the page.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, {
      body: opts.body,
      tag: opts.tag,
      icon: '/img/logos/icon-mark-teal.png',
      silent: false,
    });
    if (opts.onClick) {
      n.onclick = (e) => {
        e.preventDefault();
        window.focus();
        opts.onClick?.();
        n.close();
      };
    }
  } catch {}
}
