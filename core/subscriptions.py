"""Lawyer monthly-subscription gate.

Global default (``SubscriptionSettings.auto_check``) with an optional per-lawyer
override (``LawyerProfile.subscription_override``) that wins. Only lawyers are
ever gated; everyone else is exempt.
"""

from django.utils import timezone


def first_of_month(dt=None):
    d = (dt or timezone.now()).date()
    return d.replace(day=1)


def is_enforced_for(user) -> bool:
    """Whether the monthly-subscription gate applies to this user right now."""
    if getattr(user, 'role', None) != 'lawyer':
        return False
    profile = getattr(user, 'lawyer_profile', None)
    override = getattr(profile, 'subscription_override', 'inherit') if profile else 'inherit'
    if override == 'on':
        return True
    if override == 'off':
        return False
    from .models import SubscriptionSettings
    return SubscriptionSettings.load().auto_check


def current_subscription(user):
    """This month's Subscription row for the user, or None."""
    from .models import Subscription
    return (
        Subscription.objects.filter(user=user, period_start=first_of_month())
        .order_by('-created_at')
        .first()
    )


def is_active(user) -> bool:
    """True when the user has a verified subscription covering this month."""
    from .models import SubscriptionStatus
    sub = current_subscription(user)
    return bool(sub and sub.status == SubscriptionStatus.VERIFIED)


def status_for(user, request=None) -> dict:
    """Everything the client needs to render the gate/banner.

    ``state`` is one of: 'active' (no gate), 'required' (must pay),
    'pending' (POP uploaded, awaiting verification), 'rejected'.
    """
    from .models import SubscriptionSettings, SubscriptionStatus

    if not is_enforced_for(user):
        return {'enforced': False, 'state': 'active'}

    settings = SubscriptionSettings.load()
    sub = current_subscription(user)
    if sub and sub.status == SubscriptionStatus.VERIFIED:
        state = 'active'
    elif sub and sub.status == SubscriptionStatus.PENDING_REVIEW:
        state = 'pending'
    elif sub and sub.status == SubscriptionStatus.REJECTED:
        state = 'rejected'
    else:
        state = 'required'

    proof_url = None
    if sub and sub.proof_of_payment:
        url = sub.proof_of_payment.url
        proof_url = request.build_absolute_uri(url) if request else url

    return {
        'enforced': True,
        'state': state,
        'amount': str(settings.monthly_fee),
        'currency': settings.currency,
        'period': first_of_month().isoformat(),
        'review_note': (sub.review_note if sub else '') or '',
        'proof_url': proof_url,
    }
