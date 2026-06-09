"""Audit-log helper. Fire-and-forget; never blocks the caller on failure."""


def audit(*, actor=None, action: str, obj=None, meta=None, request=None) -> None:
    from .models import AuditEvent

    try:
        AuditEvent.objects.create(
            actor=actor,
            action=action,
            object_type=obj.__class__.__name__ if obj is not None else '',
            object_id=getattr(obj, 'pk', None),
            meta=meta or {},
            ip_address=_client_ip(request),
        )
    except Exception:  # pragma: no cover
        pass


def _client_ip(request):
    if request is None:
        return None
    fwd = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if fwd:
        return fwd.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')
