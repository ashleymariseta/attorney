"""Tiny notification helper.

Records an in-app Notification row AND fires an email through the configured
backend (defaults to console in dev). Catch-all wrapper so calling code never
crashes if email fails."""

from django.conf import settings
from django.core.mail import send_mail


def notify(*, recipient, kind, title, body='', link='', send_email=True):
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
        try:
            send_mail(
                subject=title,
                message=(body or '') + (f'\n\n{link}' if link else ''),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[recipient.email],
                fail_silently=True,
            )
            notif.sent_email = True
            notif.save(update_fields=['sent_email'])
        except Exception:
            pass
    return notif
