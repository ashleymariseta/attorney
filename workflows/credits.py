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


def _firm_for(user):
    """Return the user's firm (via their LawyerProfile) or None."""
    from core.models import LawyerProfile

    profile = (
        LawyerProfile.objects.filter(user=user).select_related('firm').first()
    )
    return profile.firm if (profile and profile.firm_id) else None


def resolve_account(*, user=None, firm=None):
    """Get-or-create the credit account that should be charged/credited.

    * ``firm`` given → that firm's account.
    * ``user`` given → their firm's account if they belong to one, else their
      own personal account.
    """
    if firm is None and user is not None:
        firm = _firm_for(user)
    if firm is not None:
        account, _ = AICreditAccount.objects.get_or_create(owner_firm=firm)
        return account
    if user is not None:
        account, _ = AICreditAccount.objects.get_or_create(owner_user=user)
        return account
    raise ValueError('resolve_account requires user or firm')


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
    account.balance -= tokens
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
