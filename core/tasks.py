from celery import shared_task
from django.db import transaction
from django.utils import timezone


def _advance_one_month(dt):
    """Return `dt` moved forward one calendar month, day pinned to the 1st."""
    year, month = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
    return dt.replace(year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0)


@shared_task
def bill_due_retainers():
    """Raise a monthly invoice for every active retainer whose billing cursor
    is due. Runs daily (Celery Beat); one invoice per lawyer, posted to the
    retainer's matter room so the client can upload proof of payment and the
    lawyer can verify it — exactly like any other invoice.

    Idempotent per cursor: after billing, ``next_invoice_at`` advances one
    month, so re-running the same day bills nothing further.
    """
    from django.contrib.auth import get_user_model  # noqa: F401 (ensures app registry)
    from core.models import Retainer, RetainerStatus, NotificationKind
    from core.notify import notify
    from payments.models import Payment, PaymentPurpose, PaymentStatus

    now = timezone.now()
    due = (
        Retainer.objects.select_related('client', 'lawyer', 'matter')
        .filter(status=RetainerStatus.ACTIVE, next_invoice_at__lte=now)
        .exclude(monthly_fee__isnull=True)
        .exclude(matter__isnull=True)
    )

    billed = 0
    for retainer in due:
        lawyer_label = retainer.lawyer.get_full_name() or retainer.lawyer.email
        period = retainer.next_invoice_at or now
        with transaction.atomic():
            # Re-lock the row to avoid double-billing under concurrent beats.
            r = Retainer.objects.select_for_update().get(pk=retainer.pk)
            if r.status != RetainerStatus.ACTIVE or r.next_invoice_at is None or r.next_invoice_at > now:
                continue
            payment = Payment.objects.create(
                matter=r.matter,
                payer=r.client,
                amount=r.monthly_fee,
                currency='USD',
                provider='manual_pop',
                purpose=PaymentPurpose.RETAINER,
                status=PaymentStatus.PENDING_REVIEW,
                reference=f'RET-{r.id}-{period.strftime("%Y%m")}',
            )
            r.next_invoice_at = _advance_one_month(r.next_invoice_at)
            r.save(update_fields=['next_invoice_at'])

        notify(
            recipient=r.client,
            kind=NotificationKind.PAYMENT,
            title=f'Monthly retainer invoice — ${r.monthly_fee}',
            body=(
                f'Your ${r.monthly_fee} monthly retainer with {lawyer_label} is due '
                f'for {period.strftime("%B %Y")}. Open the matter room to pay and '
                f'upload your proof of payment.'
            ),
            link=f'/matters/{r.matter_id}',
        )
        billed += 1

    return {'billed': billed, 'timestamp': now.isoformat()}


@shared_task
def send_retainer_reminders():
    # Placeholder task for recurring retainer billing reminders.
    return {'status': 'ok', 'timestamp': timezone.now().isoformat()}


@shared_task
def generate_consultation_summary(consultation_id):
    # Placeholder AI summary generation task.
    return {'consultation_id': consultation_id, 'status': 'generated'}
