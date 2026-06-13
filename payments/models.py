from django.conf import settings
from django.core.validators import FileExtensionValidator
from django.db import models
from django.utils import timezone


def proof_of_payment_path(instance, filename):
    """Namespace POP uploads per matter so files never collide."""
    matter_id = instance.matter_id or 'unassigned'
    return f'proofs_of_payment/matter_{matter_id}/{filename}'


class PaymentProvider(models.TextChoices):
    MANUAL_POP = 'manual_pop', 'Manual / Bank Transfer (Proof of Payment)'
    PAYNOW = 'paynow', 'Paynow'
    ECOCASH = 'ecocash', 'EcoCash'
    STRIPE = 'stripe', 'Stripe'


class PaymentPurpose(models.TextChoices):
    TRUST_DEPOSIT = 'trust_deposit', 'Trust / Escrow Deposit'
    CONSULTATION = 'consultation', 'Consultation Fee'
    INVOICE = 'invoice', 'Invoice Settlement'
    RETAINER = 'retainer', 'Retainer'


class PaymentStatus(models.TextChoices):
    PENDING_REVIEW = 'pending_review', 'Pending Review'
    PARTIAL = 'partial', 'Partial'
    VERIFIED = 'verified', 'Paid'
    REJECTED = 'rejected', 'Rejected'
    FAILED = 'failed', 'Failed'


class Payment(models.Model):
    """A client payment, optionally evidenced by an uploaded proof of payment.

    For manual / bank-transfer flows the payer uploads a POP document which an
    admin reviews. Once verified, a matching trust-ledger deposit is recorded so
    client funds are always tracked in escrow before any release to a lawyer.
    """

    matter = models.ForeignKey(
        'core.Matter', on_delete=models.CASCADE, related_name='payments'
    )
    payer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='payments'
    )
    provider = models.CharField(
        max_length=32, choices=PaymentProvider.choices, default=PaymentProvider.MANUAL_POP
    )
    purpose = models.CharField(
        max_length=32, choices=PaymentPurpose.choices, default=PaymentPurpose.TRUST_DEPOSIT
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=8, default='USD')
    reference = models.CharField(
        max_length=256, blank=True, help_text='Bank / provider transaction reference.'
    )

    proof_of_payment = models.FileField(
        upload_to=proof_of_payment_path,
        blank=True,
        null=True,
        validators=[FileExtensionValidator(['pdf', 'png', 'jpg', 'jpeg', 'webp'])],
        help_text='Uploaded proof of payment (PDF or image).',
    )

    status = models.CharField(
        max_length=32, choices=PaymentStatus.choices, default=PaymentStatus.PENDING_REVIEW
    )
    note = models.TextField(blank=True, help_text='Payer-supplied note about the payment.')

    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_payments',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True, help_text='Reviewer decision note.')

    # Set when a verified payment is posted to the internal trust ledger.
    trust_transaction = models.OneToOneField(
        'core.TrustTransaction',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payment',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['matter', 'status']),
        ]

    def __str__(self):
        return f'Payment({self.amount} {self.currency} · {self.get_status_display()})'

    @property
    def has_proof(self):
        return self.receipts.exists() or bool(self.proof_of_payment)

    # --- partial-payment roll-ups ----------------------------------------
    def _sum_receipts(self, status):
        from decimal import Decimal
        total = sum((r.amount for r in self.receipts.all() if r.status == status), start=Decimal('0'))
        return total

    @property
    def total_paid(self):
        return self._sum_receipts(PaymentStatus.VERIFIED)

    @property
    def total_pending(self):
        return self._sum_receipts(PaymentStatus.PENDING_REVIEW)

    @property
    def outstanding_amount(self):
        from decimal import Decimal
        out = (self.amount or Decimal('0')) - self.total_paid
        return out if out > 0 else Decimal('0')

    def recompute_status(self) -> str:
        """Roll up receipt statuses into the parent payment's status.

        * Any verified slice → ``partial`` until ``total_paid >= amount``.
        * No verified + at least one pending → ``pending_review``.
        * No verified + no pending + at least one rejected → ``rejected``.
        * Empty (no receipts at all) → ``pending_review`` (initial).
        """
        from decimal import Decimal
        receipts = list(self.receipts.all())
        verified = sum((r.amount for r in receipts if r.status == PaymentStatus.VERIFIED), start=Decimal('0'))
        has_pending = any(r.status == PaymentStatus.PENDING_REVIEW for r in receipts)
        has_rejected = any(r.status == PaymentStatus.REJECTED for r in receipts)

        if verified >= self.amount and self.amount > 0:
            new = PaymentStatus.VERIFIED
        elif verified > 0:
            new = PaymentStatus.PARTIAL
        elif has_pending:
            new = PaymentStatus.PENDING_REVIEW
        elif has_rejected:
            new = PaymentStatus.REJECTED
        else:
            new = self.status if self.status else PaymentStatus.PENDING_REVIEW
        if new != self.status:
            self.status = new
            self.save(update_fields=['status', 'updated_at'])
        return new

    def mark_reviewed(self, *, reviewer, status, note=''):
        """Legacy helper — still used by the trust-ledger flow. The matching
        :class:`PaymentReceipt` is created on the fly so the receipt audit
        trail stays consistent. Caller is responsible for ledger posting."""
        self.reviewed_by = reviewer
        self.reviewed_at = timezone.now()
        self.review_note = note
        self.save(update_fields=['reviewed_by', 'reviewed_at', 'review_note', 'updated_at'])
        if status == PaymentStatus.VERIFIED:
            pending = self.receipts.filter(status=PaymentStatus.PENDING_REVIEW).order_by('created_at').first()
            if pending is not None:
                pending.status = PaymentStatus.VERIFIED
                pending.reviewed_by = reviewer
                pending.reviewed_at = timezone.now()
                pending.review_note = note
                pending.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_note'])
        elif status == PaymentStatus.REJECTED:
            for r in self.receipts.filter(status=PaymentStatus.PENDING_REVIEW):
                r.status = PaymentStatus.REJECTED
                r.reviewed_by = reviewer
                r.reviewed_at = timezone.now()
                r.review_note = note
                r.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_note'])
        self.recompute_status()


def receipt_path(instance, filename):
    matter_id = getattr(instance.payment, 'matter_id', 'unassigned')
    return f'proofs_of_payment/matter_{matter_id}/{filename}'


class PaymentReceipt(models.Model):
    """One uploaded slice of money against a :class:`Payment`.

    Splitting receipts out of Payment lets a single invoice be settled in
    multiple installments — each receipt carries its own proof file,
    review state and amount. The parent ``Payment.status`` is a roll-up:
    ``verified`` once cumulative paid ≥ amount, ``partial`` while some has
    been verified, ``pending_review`` while at least one receipt is
    awaiting decision.
    """

    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name='receipts')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    proof_of_payment = models.FileField(
        upload_to=receipt_path,
        validators=[FileExtensionValidator(['pdf', 'png', 'jpg', 'jpeg', 'webp'])],
    )
    reference = models.CharField(max_length=256, blank=True)
    note = models.TextField(blank=True)
    status = models.CharField(
        max_length=32,
        choices=PaymentStatus.choices,
        default=PaymentStatus.PENDING_REVIEW,
    )
    review_note = models.TextField(blank=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True, on_delete=models.SET_NULL,
        related_name='submitted_receipts',
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True, on_delete=models.SET_NULL,
        related_name='reviewed_receipts',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['payment', 'status'])]
