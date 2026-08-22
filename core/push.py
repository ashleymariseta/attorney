"""Firebase Cloud Messaging (FCM) push delivery.

Env-guarded: if no Firebase service-account credentials are configured the
whole module no-ops, so the app runs fine without push set up. Configure with
ONE of:

  * ``FCM_CREDENTIALS_FILE`` — path to the service-account JSON, or
  * ``FCM_CREDENTIALS_JSON`` — the service-account JSON inline (e.g. in a
    single env var on the host).

Nothing here ever raises into the caller — push is best-effort.
"""

import json
import logging

logger = logging.getLogger(__name__)

_app = None
_init_attempted = False


def _get_app():
    """Lazily initialise (once) the Firebase Admin app from env creds.
    Returns the app, or None when FCM isn't configured / unavailable."""
    global _app, _init_attempted
    if _app is not None:
        return _app
    if _init_attempted:
        return None
    _init_attempted = True

    from django.conf import settings

    raw = getattr(settings, 'FCM_CREDENTIALS_JSON', '') or ''
    path = getattr(settings, 'FCM_CREDENTIALS_FILE', '') or ''
    if not raw and not path:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials

        if raw:
            cred = credentials.Certificate(json.loads(raw))
        else:
            cred = credentials.Certificate(path)
        _app = firebase_admin.initialize_app(cred, name='attorney-fcm')
        return _app
    except Exception as exc:  # missing dep, bad creds, etc.
        logger.warning('FCM init failed (%s); push disabled.', exc)
        return None


def is_configured() -> bool:
    return _get_app() is not None


def send_push_to_user(user, title, body='', data=None, link=''):
    """Fan a push out to every active device token owned by ``user``.

    Best-effort: returns the number of successful sends (0 if FCM is off).
    Prunes tokens FCM reports as unregistered/invalid.
    """
    app = _get_app()
    if app is None:
        return 0
    from .models import DeviceToken

    tokens = list(
        DeviceToken.objects.filter(user=user, is_active=True).values_list('token', flat=True)
    )
    if not tokens:
        return 0

    try:
        from firebase_admin import messaging
    except Exception:
        return 0

    # FCM data payload values must all be strings.
    payload = {str(k): str(v) for k, v in (data or {}).items()}
    if link:
        payload['link'] = str(link)

    sent = 0
    stale = []
    for token in tokens:
        message = messaging.Message(
            token=token,
            notification=messaging.Notification(title=title, body=body or None),
            data=payload,
            android=messaging.AndroidConfig(priority='high'),
            apns=messaging.APNSConfig(
                payload=messaging.APNSPayload(aps=messaging.Aps(sound='default')),
            ),
        )
        try:
            messaging.send(message, app=app)
            sent += 1
        except messaging.UnregisteredError:
            stale.append(token)
        except Exception as exc:
            logger.warning('FCM send failed for a token (%s).', exc)

    if stale:
        DeviceToken.objects.filter(token__in=stale).update(is_active=False)
    return sent
