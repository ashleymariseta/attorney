from django.db import transaction
from django.db.models import Q
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from core.models import (
    Consultation,
    ConsultationStatus,
    TrustTransaction,
    TrustTransactionStatus,
    TrustTransactionType,
)

from .models import Payment, PaymentPurpose, PaymentStatus
from .providers import get_provider
from .serializers import (
    PaymentReviewSerializer,
    PaymentSerializer,
    ProofOfPaymentUploadSerializer,
)


class PaymentViewSet(viewsets.ModelViewSet):
    """Payments + Proof-of-Payment workflow.

    * Clients create a payment and upload a proof of payment (POP).
    * Admins review the POP; verifying it posts a deposit to the trust ledger.
    """

    serializer_class = PaymentSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    filterset_fields = ['matter', 'status', 'provider', 'purpose']
    search_fields = ['reference', 'note']
    ordering_fields = ['created_at', 'amount']

    queryset = Payment.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Payment.objects.none()
        user = self.request.user
        qs = Payment.objects.select_related('matter', 'payer', 'reviewed_by')
        if user.is_superuser or getattr(user, 'role', None) == 'admin':
            return qs
        # Payers see their own payments and those on matters they participate in.
        return qs.filter(
            Q(payer=user) | Q(matter__client=user) | Q(matter__lawyers=user)
        ).distinct()

    def perform_create(self, serializer):
        provider = get_provider(serializer.validated_data.get('provider', 'manual_pop'))
        result = provider.initiate(
            amount=serializer.validated_data['amount'],
            currency=serializer.validated_data.get('currency', 'USD'),
            reference=serializer.validated_data.get('reference', ''),
        )
        # The client on the matter always owes the funds — whether they deposit
        # proactively or a lawyer raises a payment request on the matter.
        matter = serializer.validated_data['matter']
        serializer.save(
            payer=matter.client,
            reference=serializer.validated_data.get('reference', '') or result.reference,
            status=PaymentStatus.PENDING_REVIEW,
        )

    @extend_schema(
        request=ProofOfPaymentUploadSerializer,
        responses=PaymentSerializer,
        summary='Upload (or replace) the proof of payment for a payment.',
    )
    @action(
        detail=True,
        methods=['post'],
        url_path='upload-proof',
        parser_classes=[MultiPartParser, FormParser],
    )
    def upload_proof(self, request, pk=None):
        payment = self.get_object()
        if payment.status == PaymentStatus.VERIFIED:
            return Response(
                {'detail': 'This payment has already been verified.'},
                status=status.HTTP_409_CONFLICT,
            )

        upload = ProofOfPaymentUploadSerializer(data=request.data)
        upload.is_valid(raise_exception=True)

        payment.proof_of_payment = upload.validated_data['proof_of_payment']
        if upload.validated_data.get('reference'):
            payment.reference = upload.validated_data['reference']
        if upload.validated_data.get('note'):
            payment.note = upload.validated_data['note']
        # Re-submitting a POP after a rejection resets it for review.
        payment.status = PaymentStatus.PENDING_REVIEW
        payment.save()

        # A consultation booking that was awaiting payment can now await the
        # lawyer's confirmation.
        if payment.purpose == PaymentPurpose.CONSULTATION:
            Consultation.objects.filter(
                matter=payment.matter, status=ConsultationStatus.AWAITING_PAYMENT
            ).update(status=ConsultationStatus.PENDING)

        return Response(self.get_serializer(payment).data, status=status.HTTP_200_OK)

    @extend_schema(
        request=PaymentReviewSerializer,
        responses={200: PaymentSerializer, 400: OpenApiResponse(description='Invalid review')},
        summary='Admin: verify or reject a submitted proof of payment.',
    )
    @action(detail=True, methods=['post'], permission_classes=[IsAdminUser])
    def review(self, request, pk=None):
        payment = self.get_object()
        review = PaymentReviewSerializer(data=request.data)
        review.is_valid(raise_exception=True)
        decision = review.validated_data['status']
        note = review.validated_data.get('review_note', '')

        if decision == PaymentStatus.VERIFIED and not payment.has_proof:
            return Response(
                {'detail': 'Cannot verify a payment with no proof of payment attached.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            payment.mark_reviewed(reviewer=request.user, status=decision, note=note)
            if decision == PaymentStatus.VERIFIED and payment.trust_transaction is None:
                # Post the verified funds into escrow on the internal ledger.
                txn = TrustTransaction.objects.create(
                    matter=payment.matter,
                    transaction_type=TrustTransactionType.DEPOSIT,
                    amount=payment.amount,
                    currency=payment.currency,
                    provider_reference=payment.reference,
                    status=TrustTransactionStatus.COMPLETED,
                )
                payment.trust_transaction = txn
                payment.save(update_fields=['trust_transaction', 'updated_at'])

        return Response(self.get_serializer(payment).data, status=status.HTTP_200_OK)
