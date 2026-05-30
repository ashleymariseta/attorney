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
    VERIFIED = 'verified', 'Verified'
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
        return bool(self.proof_of_payment)

    def mark_reviewed(self, *, reviewer, status, note=''):
        """Record a reviewer decision. Caller is responsible for ledger posting."""
        self.status = status
        self.reviewed_by = reviewer
        self.reviewed_at = timezone.now()
        self.review_note = note
        self.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'])
