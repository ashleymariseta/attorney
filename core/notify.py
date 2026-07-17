"""Tiny notification helper.

Records an in-app Notification row AND fires a branded HTML email through the
configured backend (defaults to console in dev). Catch-all wrapper so calling
code never crashes if email fails."""


def notify(*, recipient, kind, title, body='', link='', send_email=True, button_label='Open Attorney'):
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
    if send_email and recipient.email and '@invite.attorney.local' not in recipient.email:
        paras = paragraphs_from_body(body)
        if link:
            # The link becomes a button — drop any paragraph that is just the URL.
            paras = [p for p in paras if link not in p]
        if not paras:
            paras = [body] if body else [title]
        ok = send_branded(
            to=recipient.email,
            subject=title,
            heading=title,
            paragraphs=paras,
            button=(button_label, link) if link else None,
        )
        if ok:
            notif.sent_email = True
            notif.save(update_fields=['sent_email'])
    return notif
