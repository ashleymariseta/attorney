from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Payment, PaymentReceipt, PaymentStatus


class PaymentReceiptSerializer(serializers.ModelSerializer):
    proof_of_payment_url = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = PaymentReceipt
        fields = [
            'id', 'payment', 'amount', 'reference', 'note',
            'status', 'status_display', 'review_note',
            'submitted_by', 'reviewed_by', 'reviewed_at',
            'proof_of_payment', 'proof_of_payment_url',
            'created_at',
        ]
        read_only_fields = [
            'payment', 'status', 'review_note', 'submitted_by',
            'reviewed_by', 'reviewed_at', 'created_at',
        ]
        extra_kwargs = {'proof_of_payment': {'write_only': True}}

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_proof_of_payment_url(self, obj):
        if not obj.proof_of_payment:
            return None
        request = self.context.get('request')
        url = obj.proof_of_payment.url
        return request.build_absolute_uri(url) if request else url


class PaymentSerializer(serializers.ModelSerializer):
    """Read/representation serializer for payments."""

    proof_of_payment_url = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    receipts = PaymentReceiptSerializer(many=True, read_only=True)
    total_paid = serializers.SerializerMethodField()
    total_pending = serializers.SerializerMethodField()
    outstanding_amount = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            'id',
            'matter',
            'payer',
            'provider',
            'purpose',
            'amount',
            'currency',
            'reference',
            'proof_of_payment',
            'proof_of_payment_url',
            'status',
            'status_display',
            'note',
            'reviewed_by',
            'reviewed_at',
            'review_note',
            'trust_transaction',
            'receipts',
            'total_paid',
            'total_pending',
            'outstanding_amount',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'payer',
            'status',
            'reviewed_by',
            'reviewed_at',
            'review_note',
            'trust_transaction',
            'created_at',
            'updated_at',
        ]
        extra_kwargs = {
            # POP is supplied via the dedicated upload serializer/endpoint.
            'proof_of_payment': {'write_only': True, 'required': False},
        }

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_proof_of_payment_url(self, obj):
        # Surface the *latest* receipt's file as the convenience POP URL so
        # existing UI that reads ``proof_of_payment_url`` keeps working.
        latest = obj.receipts.exclude(proof_of_payment='').first()
        if latest is not None and latest.proof_of_payment:
            request = self.context.get('request')
            url = latest.proof_of_payment.url
            return request.build_absolute_uri(url) if request else url
        if not obj.proof_of_payment:
            return None
        request = self.context.get('request')
        url = obj.proof_of_payment.url
        return request.build_absolute_uri(url) if request else url

    def get_total_paid(self, obj):
        return str(obj.total_paid)

    def get_total_pending(self, obj):
        return str(obj.total_pending)

    def get_outstanding_amount(self, obj):
        return str(obj.outstanding_amount)

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        return value

    def validate_matter(self, matter):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user is None or user.is_superuser or getattr(user, 'role', None) == 'admin':
            return matter
        # A payer may only attach a payment to a matter they participate in.
        is_member = (
            matter.client_id == user.id
            or matter.lawyers.filter(pk=user.id).exists()
        )
        if not is_member:
            raise serializers.ValidationError('You are not a participant in this matter.')
        return matter


class ProofOfPaymentUploadSerializer(serializers.Serializer):
    """Attach a proof-of-payment file to an existing payment.

    Each upload becomes one :class:`PaymentReceipt` of ``amount``.
    When ``amount`` is omitted we default to the payment's outstanding
    balance so the legacy "POP for the full bill" flow still works.
    """

    proof_of_payment = serializers.FileField()
    amount = serializers.DecimalField(
        required=False, max_digits=12, decimal_places=2, min_value=0,
    )
    reference = serializers.CharField(required=False, allow_blank=True, max_length=256)
    note = serializers.CharField(required=False, allow_blank=True)


class PaymentReviewSerializer(serializers.Serializer):
    """Admin decision on a submitted proof of payment."""

    status = serializers.ChoiceField(
        choices=[PaymentStatus.VERIFIED, PaymentStatus.REJECTED]
    )
    review_note = serializers.CharField(required=False, allow_blank=True)
