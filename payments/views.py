from io import BytesIO

from django.db import transaction
from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

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
        summary='Admin or assigned lawyer: verify or reject a submitted proof of payment.',
    )
    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        payment = self.get_object()
        user = request.user
        is_admin = bool(getattr(user, 'is_superuser', False) or getattr(user, 'role', None) == 'admin')
        is_assigned_lawyer = payment.matter.lawyers.filter(pk=user.pk).exists()
        if not (is_admin or is_assigned_lawyer):
            return Response(
                {'detail': 'Only an admin or the assigned lawyer can review this payment.'},
                status=status.HTTP_403_FORBIDDEN,
            )
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

    @action(detail=True, methods=['post'])
    def comment(self, request, pk=None):
        """Append a timestamped comment to the payment note."""
        payment = self.get_object()
        body = (request.data.get('body') or '').strip()
        if not body:
            return Response({'detail': 'Comment body is required.'}, status=status.HTTP_400_BAD_REQUEST)
        user = request.user
        stamp = timezone.now().strftime('%Y-%m-%d %H:%M')
        author = user.get_full_name() or user.email
        entry = f'[{stamp} — {author}] {body}'
        payment.note = (payment.note + '\n' + entry).strip() if payment.note else entry
        payment.save(update_fields=['note', 'updated_at'])
        return Response(self.get_serializer(payment).data, status=status.HTTP_200_OK)

    @extend_schema(
        responses={200: OpenApiResponse(description='PDF invoice download')},
        summary='Download a PDF invoice for this payment.',
    )
    @action(detail=True, methods=['get'], url_path='invoice-pdf')
    def invoice_pdf(self, request, pk=None):
        payment = self.get_object()
        buf = BytesIO()
        doc = SimpleDocTemplate(
            buf,
            pagesize=A4,
            leftMargin=22 * mm,
            rightMargin=22 * mm,
            topMargin=22 * mm,
            bottomMargin=22 * mm,
            title=f'Invoice INV-{payment.id:05d}',
        )

        brand_dark = colors.HexColor('#082826')
        brand = colors.HexColor('#0f766e')
        muted = colors.HexColor('#64748b')
        line = colors.HexColor('#e5e7eb')

        styles = getSampleStyleSheet()
        styles.add(ParagraphStyle(name='ATSmall', fontName='Helvetica', fontSize=8, textColor=muted, leading=10))
        styles.add(ParagraphStyle(name='ATEyebrow', fontName='Helvetica-Bold', fontSize=8, textColor=muted, leading=10, spaceAfter=2))
        styles.add(ParagraphStyle(name='ATValue', fontName='Helvetica', fontSize=10, textColor=brand_dark, leading=13))
        styles.add(ParagraphStyle(name='ATBrand', fontName='Helvetica-Bold', fontSize=14, textColor=brand, leading=16))

        matter = payment.matter
        lawyer = matter.lawyers.first()
        client = matter.client
        lawyer_name = (getattr(lawyer, 'get_full_name', lambda: '')() if lawyer else '') or (lawyer.email if lawyer else '—')
        client_name = (getattr(client, 'get_full_name', lambda: '')() if client else '') or (client.email if client else '—')
        lawyer_email = getattr(lawyer, 'email', '') if lawyer else ''
        client_email = getattr(client, 'email', '') if client else ''

        is_paid = payment.status == PaymentStatus.VERIFIED
        status_label = 'PAID' if is_paid else payment.get_status_display().upper()
        status_hex = '#059669' if is_paid else '#92400e'

        elements = []
        header = Table(
            [
                [Paragraph('ATTORNEY', styles['ATBrand']),
                 Paragraph(f'<font color="{status_hex}"><b>{status_label}</b></font>', styles['ATBrand'])],
                [Paragraph('Law &amp; Advisory', styles['ATSmall']),
                 Paragraph(f'Invoice INV-{payment.id:05d}', styles['ATSmall'])],
            ],
            colWidths=[None, 70 * mm],
        )
        header.setStyle(TableStyle([
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LINEBELOW', (0, 1), (-1, 1), 1, line),
            ('BOTTOMPADDING', (0, 1), (-1, 1), 10),
        ]))
        elements.append(header)
        elements.append(Spacer(1, 14))

        bill = Table(
            [
                [Paragraph('FROM', styles['ATEyebrow']), Paragraph('BILL TO', styles['ATEyebrow'])],
                [Paragraph(f'<b>{lawyer_name}</b><br/>{lawyer_email}', styles['ATValue']),
                 Paragraph(f'<b>{client_name}</b><br/>{client_email}', styles['ATValue'])],
            ],
        )
        bill.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BOTTOMPADDING', (0, 0), (-1, -1), 2)]))
        elements.append(bill)
        elements.append(Spacer(1, 18))

        meta = Table(
            [
                [Paragraph('ISSUED', styles['ATEyebrow']),
                 Paragraph('MATTER', styles['ATEyebrow']),
                 Paragraph('PURPOSE', styles['ATEyebrow'])],
                [Paragraph(payment.created_at.strftime('%d %b %Y'), styles['ATValue']),
                 Paragraph(matter.title, styles['ATValue']),
                 Paragraph(payment.get_purpose_display(), styles['ATValue'])],
            ],
        )
        meta.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BOTTOMPADDING', (0, 0), (-1, -1), 2)]))
        elements.append(meta)
        elements.append(Spacer(1, 18))

        items = Table(
            [
                ['DESCRIPTION', 'AMOUNT'],
                [matter.title + ' — ' + payment.get_purpose_display(), f'{payment.amount} {payment.currency}'],
            ],
            colWidths=[None, 50 * mm],
        )
        items.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('TEXTCOLOR', (0, 0), (-1, 0), muted),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f8fafc')),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, 1), (-1, 1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, 1), 10),
            ('TEXTCOLOR', (0, 1), (-1, 1), brand_dark),
            ('LINEABOVE', (0, 0), (-1, 0), 1, line),
            ('LINEBELOW', (0, 0), (-1, 0), 1, line),
            ('LINEBELOW', (0, 1), (-1, 1), 1, line),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ]))
        elements.append(items)
        elements.append(Spacer(1, 6))

        total = Table(
            [['TOTAL DUE' if not is_paid else 'TOTAL', f'{payment.amount} {payment.currency}']],
            colWidths=[None, 50 * mm],
        )
        total.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (0, 0), 10),
            ('FONTSIZE', (1, 0), (1, 0), 14),
            ('TEXTCOLOR', (0, 0), (-1, 0), brand_dark),
            ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
            ('TOPPADDING', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ]))
        elements.append(total)
        elements.append(Spacer(1, 24))

        notes = (
            'Payment has been received and recorded against the matter trust ledger.'
            if is_paid
            else "Please remit payment using one of the supported methods (EcoCash, OneMoney, Bank EFT, "
            "InnBucks, O'mari, or cash). Upload your proof of payment in the matter room."
        )
        elements.append(Paragraph(notes, styles['ATSmall']))
        elements.append(Spacer(1, 12))
        elements.append(
            Paragraph(
                'Funds are held in escrow on the internal trust ledger until released. '
                'Questions? Reply in the matter room.',
                styles['ATSmall'],
            )
        )

        doc.build(elements)
        buf.seek(0)
        filename = f'Invoice-INV-{payment.id:05d}.pdf'
        return FileResponse(buf, as_attachment=True, filename=filename, content_type='application/pdf')
