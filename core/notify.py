"""Tiny notification helper.

Records an in-app Notification row AND fires a branded HTML email through the
configured backend (defaults to console in dev). Catch-all wrapper so calling
code never crashes if email fails."""


def notify(
    *,
    recipient,
    kind,
    title,
    body='',
    link='',
    send_email=True,
    button_label='Open Attorney',
    highlight=None,
):
    """Record an in-app notification and (optionally) send a branded email.

    ``link`` is stored verbatim for in-app routing (usually a relative path like
    ``/matters/12``); the email button turns it into an absolute URL via
    ``FRONTEND_URL``. ``highlight`` is an optional ``(label, value)`` card
    featured in the email (e.g. the matter title or consultation time).
    """
    from django.conf import settings
    from .emails import paragraphs_from_body, send_branded
    from .models import Notification  # local import to avoid cycle

    notif = Notification.objects.create(
        recipient=recipient,
        kind=kind,
        title=title,
        body=body,
        link=link,
        sent_email=False,
    )
    # Push it to the recipient's own SSE feed so the bell updates without a
    # reload. Never raises — realtime must not break the notification.
    from .sse import publish_user_event

    publish_user_event(
        recipient.id,
        {'type': 'notification', 'kind': str(kind), 'id': notif.id, 'title': title},
    )
    # Best-effort FCM push to the recipient's devices. No-ops if FCM isn't
    # configured and never raises into the caller.
    try:
        from .push import send_push_to_user

        send_push_to_user(recipient, title, body=body, link=link, data={'kind': str(kind)})
    except Exception:
        pass
    if send_email and recipient.email and '@invite.attorney.local' not in recipient.email:
        paras = paragraphs_from_body(body)
        if link:
            # The link becomes a button — drop any paragraph that is just the URL.
            paras = [p for p in paras if link not in p]
        if not paras:
            paras = [body] if body else [title]
        # In-app links are relative; email buttons need an absolute URL.
        button_url = link
        if button_url.startswith('/'):
            button_url = settings.FRONTEND_URL.rstrip('/') + button_url
        ok = send_branded(
            to=recipient.email,
            subject=title,
            heading=title,
            paragraphs=paras,
            button=(button_label, button_url) if button_url else None,
            highlight=highlight,
        )
        if ok:
            notif.sent_email = True
            notif.save(update_fields=['sent_email'])
    return notif
