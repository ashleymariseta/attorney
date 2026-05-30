from celery import shared_task
from django.utils import timezone


@shared_task
def send_retainer_reminders():
    # Placeholder task for recurring retainer billing reminders.
    return {'status': 'ok', 'timestamp': timezone.now().isoformat()}


@shared_task
def generate_consultation_summary(consultation_id):
    # Placeholder AI summary generation task.
    return {'consultation_id': consultation_id, 'status': 'generated'}
