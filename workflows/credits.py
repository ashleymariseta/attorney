"""AI credit ledger — the prepaid token balance that gates the AI module.

All balance mutations go through here so the cached ``AICreditAccount.balance``
always matches the append-only ``AICreditTransaction`` ledger. Views must not
touch ``balance`` directly.

Account resolution mirrors consumption: a lawyer who belongs to a firm draws
from (and is granted to) the firm's shared account; a solo lawyer uses their
own. See :func:`resolve_account`.
"""
from django.db import transaction
from django.utils import timezone

from .models import (
    AICreditAccount,
    AICreditOrder,
    AICreditTransaction,
    CreditOrderStatus,
    CreditTxnKind,
)


class InsufficientCreditsError(Exception):
    """Raised when a lawyer/firm has no AI credit balance left. Surfaced to the
    API as HTTP 402 Payment Required."""


def firm_for(user):
    """Return the user's firm (via their LawyerProfile) or None."""
    from core.models import LawyerProfile

    profile = (
        LawyerProfile.objects.filter(user=user).select_related('firm').first()
    )
    return profile.firm if (profile and profile.firm_id) else None


# Backwards-compatible private alias.
_firm_for = firm_for


def resolve_account(*, user=None, firm=None):
    """Get-or-create the credit account that should be charged/credited.

    * ``firm`` given → that firm's account.
    * ``user`` given → their firm's account if they belong to one, else their
      own personal account.

    Newly relevant accounts receive their one-time free-tier credits here.
    """
    if firm is None and user is not None:
        firm = _firm_for(user)
    if firm is not None:
        account, _ = AICreditAccount.objects.get_or_create(owner_firm=firm)
    elif user is not None:
        account, _ = AICreditAccount.objects.get_or_create(owner_user=user)
    else:
        raise ValueError('resolve_account requires user or firm')
    _ensure_free_tier(account)
    account.refresh_from_db()
    return account


def _ensure_free_tier(account) -> None:
    """Grant the configured free-tier credits to an account exactly once."""
    from .models import AIPlatformSettings, CreditTxnKind

    if account.free_tier_granted:
        return
    amount = AIPlatformSettings.load().free_tier_credits
    if amount and amount > 0:
        grant_credits(account, amount, kind=CreditTxnKind.GRANT, note='Free tier')
    # Mark granted even when the amount is 0 so we don't retry on every call.
    account.free_tier_granted = True
    account.save(update_fields=['free_tier_granted', 'updated_at'])


def is_on_paid_plan(account) -> bool:
    """True once the account has at least one verified (paid) credit order."""
    from .models import AICreditOrder, CreditOrderStatus

    qs = AICreditOrder.objects.filter(status=CreditOrderStatus.VERIFIED)
    if account.owner_firm_id:
        return qs.filter(owner_firm_id=account.owner_firm_id).exists()
    if account.owner_user_id:
        return qs.filter(owner_user_id=account.owner_user_id).exists()
    return False


def balance_for(user) -> int:
    """Current token balance for the account a user's runs are charged to."""
    return resolve_account(user=user).balance


def has_credits(user) -> bool:
    """True when there's a positive balance to start a call. Tokens are debited
    after the call completes, so any positive balance lets a call begin."""
    return balance_for(user) > 0


def assert_can_spend(user) -> None:
    """Gate before an AI call. Raises :class:`InsufficientCreditsError`."""
    if not has_credits(user):
        raise InsufficientCreditsError(
            'Your AI credit balance is exhausted. Buy an AI credit pack and upload '
            'proof of payment to unlock more.'
        )


@transaction.atomic
def grant_credits(account, tokens, *, kind=CreditTxnKind.GRANT, order=None, actor=None, note='') -> AICreditTransaction:
    """Credit ``tokens`` to an account and append a ledger row."""
    account = AICreditAccount.objects.select_for_update().get(pk=account.pk)
    account.balance += tokens
    account.lifetime_granted += max(tokens, 0)
    account.save(update_fields=['balance', 'lifetime_granted', 'updated_at'])
    return AICreditTransaction.objects.create(
        account=account, kind=kind, amount=tokens, balance_after=account.balance,
        order=order, actor=actor, note=note,
    )


@transaction.atomic
def debit_credits(account, tokens, *, usage_log=None, note='') -> AICreditTransaction | None:
    """Debit ``tokens`` (a positive number) from an account. No-op for <= 0."""
    if tokens <= 0:
        return None
    account = AICreditAccount.objects.select_for_update().get(pk=account.pk)
    # Never let a balance go negative — a call that overshoots the remaining
    # credits simply zeroes it out. lifetime_spent still tracks true usage.
    account.balance = max(0, account.balance - tokens)
    account.lifetime_spent += tokens
    account.save(update_fields=['balance', 'lifetime_spent', 'updated_at'])
    return AICreditTransaction.objects.create(
        account=account, kind=CreditTxnKind.DEBIT, amount=-tokens, balance_after=account.balance,
        usage_log=usage_log, note=note,
    )


def charge_usage(user, completion=None, *, usage_log=None, note='') -> None:
    """Debit a completed call's tokens from the user's account. Safe to call
    even when ``completion`` is None (e.g. provider error → nothing to charge)."""
    if completion is None:
        return
    tokens = int(getattr(completion, 'tokens_in', 0) or 0) + int(getattr(completion, 'tokens_out', 0) or 0)
    if tokens <= 0:
        return
    debit_credits(resolve_account(user=user), tokens, usage_log=usage_log, note=note)


# How many tokens to reserve up-front, before the real cost is known. A run is
# blocked unless the account can cover (at least part of) this. Reconciled to
# the actual token count after the call.
ESTIMATED_TOKENS_PER_CALL = 6000


@transaction.atomic
def begin_charge(user, estimate: int = ESTIMATED_TOKENS_PER_CALL) -> int:
    """Atomically reserve credits before an AI call so concurrent runs can't
    overspend a balance. Locks the account row, checks the balance, and holds
    ``min(estimate, balance)`` tokens. Returns the amount held. Raises
    :class:`InsufficientCreditsError` when the balance is exhausted.

    Always pair with :func:`release_charge` (on success *and* every failure
    path) to reconcile the hold to actual usage and refund the remainder.
    """
    account = resolve_account(user=user)
    locked = AICreditAccount.objects.select_for_update().get(pk=account.pk)
    if locked.balance <= 0:
        raise InsufficientCreditsError(
            'Your AI credit balance is exhausted. Buy an AI credit pack and upload '
            'proof of payment to unlock more.'
        )
    hold = min(int(estimate), locked.balance)
    locked.balance -= hold
    locked.save(update_fields=['balance', 'updated_at'])
    AICreditTransaction.objects.create(
        account=locked, kind=CreditTxnKind.HOLD, amount=-hold,
        balance_after=locked.balance, note='AI run reserved',
    )
    return hold


@transaction.atomic
def release_charge(user, hold: int, actual_tokens: int, *, usage_log=None, note='') -> None:
    """Reconcile a reservation from :func:`begin_charge` to actual usage:
    refund the unused portion (or debit any overage) and record the real spend.
    Pass ``actual_tokens=0`` when the call failed to refund the whole hold."""
    account = AICreditAccount.objects.select_for_update().get(pk=resolve_account(user=user).pk)
    actual = max(int(actual_tokens or 0), 0)
    delta = int(hold) - actual  # > 0 → refund unused; < 0 → debit overage
    # Floor at 0 — an overage that exceeds the remaining balance just zeroes it
    # out rather than going negative.
    account.balance = max(0, account.balance + delta)
    account.lifetime_spent += actual
    account.save(update_fields=['balance', 'lifetime_spent', 'updated_at'])
    AICreditTransaction.objects.create(
        account=account, kind=CreditTxnKind.DEBIT, amount=delta,
        balance_after=account.balance, usage_log=usage_log,
        note=note or f'AI run settled ({actual} tokens)',
    )


def _order_recipients(order):
    """Who to tell about an order's outcome: the submitting lawyer, the
    personal owner, and (for firm orders) the firm's admin."""
    seen = set()
    out = []
    for user in (
        getattr(order, 'created_by', None),
        getattr(order, 'owner_user', None),
        getattr(getattr(order, 'owner_firm', None), 'admin', None),
    ):
        if user is not None and user.pk not in seen:
            seen.add(user.pk)
            out.append(user)
    return out


def notify_order_outcome(order, *, verified, reason=''):
    """Email + in-app notify the lawyer that their credit order was verified
    or rejected. Never raises."""
    from core.models import NotificationKind
    from core.notify import notify

    try:
        if verified:
            title = f'AI credits unlocked — {order.token_credits:,} credits'
            body = (
                f'Your payment was verified and {order.token_credits:,} AI credits have been '
                f'added to {order.owner_label.split(": ", 1)[-1]}. They\'re ready to use in '
                f'AI Workflows and AI-Researcher.'
            )
        else:
            title = 'AI credit payment rejected'
            body = 'Your AI credit proof of payment was not accepted.'
            if reason:
                body += f'\n\nReason: {reason}'
            body += '\n\nPlease check the details and submit a new proof of payment.'
        link = '/ai-workflows/credits'
        for user in _order_recipients(order):
            notify(recipient=user, kind=NotificationKind.PAYMENT, title=title, body=body, link=link)
    except Exception:
        pass


@transaction.atomic
def verify_order(order, *, reviewer, note='') -> AICreditTransaction:
    """Approve a pending credit order: grant its credits to the resolved
    account and mark it verified. Idempotent-ish — refuses to double-grant."""
    order = AICreditOrder.objects.select_for_update().get(pk=order.pk)
    if order.status == CreditOrderStatus.VERIFIED:
        raise ValueError('Order already verified.')
    account = resolve_account(user=order.owner_user, firm=order.owner_firm)
    txn = grant_credits(
        account, order.token_credits, order=order, actor=reviewer,
        note=note or f'Order #{order.pk} verified',
    )
    order.status = CreditOrderStatus.VERIFIED
    order.reviewed_by = reviewer
    order.reviewed_at = timezone.now()
    order.review_note = note
    order.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'])
    transaction.on_commit(lambda: notify_order_outcome(order, verified=True))
    return txn


@transaction.atomic
def reject_order(order, *, reviewer, note='') -> None:
    """Reject a pending order. No credits are granted."""
    order = AICreditOrder.objects.select_for_update().get(pk=order.pk)
    if order.status == CreditOrderStatus.VERIFIED:
        raise ValueError('Cannot reject an already-verified order; issue a refund/adjustment instead.')
    order.status = CreditOrderStatus.REJECTED
    order.reviewed_by = reviewer
    order.reviewed_at = timezone.now()
    order.review_note = note
    order.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'])
    transaction.on_commit(lambda: notify_order_outcome(order, verified=False, reason=note))
