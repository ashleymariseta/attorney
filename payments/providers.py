"""Provider-agnostic payment abstraction.

The platform never hardcodes a single processor. Every concrete provider
(Paynow, EcoCash, Stripe, or a manual proof-of-payment flow) implements this
interface, and the rest of the codebase depends only on the abstraction. The
internal trust/escrow ledger is provider-independent.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass
from decimal import Decimal


@dataclass
class ChargeResult:
    success: bool
    reference: str = ''
    # 'verified' for instant captures, 'pending_review' for manual POP flows.
    status: str = 'pending_review'
    detail: str = ''


class BasePaymentProvider(abc.ABC):
    """Contract every payment provider adapter must satisfy."""

    name: str = 'base'
    #: Whether this provider relies on a human-reviewed proof-of-payment upload.
    requires_proof_of_payment: bool = False

    @abc.abstractmethod
    def initiate(self, *, amount: Decimal, currency: str, reference: str = '', **kwargs) -> ChargeResult:
        """Begin a charge/collection and return its initial result."""

    def verify(self, reference: str) -> ChargeResult:  # pragma: no cover - optional hook
        """Reconcile a payment against the provider. Override where supported."""
        return ChargeResult(success=False, reference=reference, detail='verify not supported')


class ManualProofOfPaymentProvider(BasePaymentProvider):
    """Bank-transfer / cash flow: the payer uploads a POP, an admin verifies it."""

    name = 'manual_pop'
    requires_proof_of_payment = True

    def initiate(self, *, amount, currency, reference='', **kwargs) -> ChargeResult:
        return ChargeResult(
            success=True,
            reference=reference,
            status='pending_review',
            detail='Awaiting proof-of-payment review.',
        )


# Registry — concrete gateway adapters (Paynow/EcoCash/Stripe) register here as
# they are implemented. Until then the manual POP flow is the default.
PROVIDERS: dict[str, BasePaymentProvider] = {
    ManualProofOfPaymentProvider.name: ManualProofOfPaymentProvider(),
}


def get_provider(name: str) -> BasePaymentProvider:
    try:
        return PROVIDERS[name]
    except KeyError:
        raise ValueError(f'Unknown payment provider: {name!r}')
