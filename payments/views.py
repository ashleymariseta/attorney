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
    Matter,
    TimeEntry,
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


def _broadcast_payment(payment: Payment, *, kind: str) -> None:
    """Push a payment.* event to the matter's chat channel so open matter
    rooms refresh their payment cards live."""
    channel = payment.matter.channels.filter(channel_type='matter').first()
    if channel is None:
        return
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f'channel_{channel.id}',
            {
                'type': 'channel.event',
                'payload': {'kind': kind, 'payment_id': payment.id, 'matter_id': payment.matter_id},
            },
        )
    except Exception:
        pass


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
        payment = serializer.save(
            payer=matter.client,
            reference=serializer.validated_data.get('reference', '') or result.reference,
            status=PaymentStatus.PENDING_REVIEW,
        )
        _broadcast_payment(payment, kind='payment.created')

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
        from decimal import Decimal
        from .models import PaymentReceipt

        payment = self.get_object()
        if payment.status == PaymentStatus.VERIFIED:
            return Response(
                {'detail': 'This payment has already been settled in full.'},
                status=status.HTTP_409_CONFLICT,
            )

        upload = ProofOfPaymentUploadSerializer(data=request.data)
        upload.is_valid(raise_exception=True)

        outstanding = payment.outstanding_amount
        raw_amount = upload.validated_data.get('amount')
        amount = Decimal(raw_amount) if raw_amount is not None else outstanding
        if amount <= 0:
            return Response(
                {'detail': 'Amount must be greater than zero.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if amount > outstanding:
            return Response(
                {'detail': f'Amount exceeds the outstanding balance of {outstanding} {payment.currency}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ref = upload.validated_data.get('reference', '') or ''
        note = upload.validated_data.get('note', '') or ''
        with transaction.atomic():
            PaymentReceipt.objects.create(
                payment=payment,
                amount=amount,
                proof_of_payment=upload.validated_data['proof_of_payment'],
                reference=ref,
                note=note,
                status=PaymentStatus.PENDING_REVIEW,
                submitted_by=request.user,
            )
            if ref:
                payment.reference = ref
            if note:
                payment.note = note
            payment.save(update_fields=['reference', 'note', 'updated_at'])
            payment.recompute_status()

        # A consultation booking that was awaiting payment can now await the
        # lawyer's confirmation.
        if payment.purpose == PaymentPurpose.CONSULTATION:
            Consultation.objects.filter(
                matter=payment.matter, status=ConsultationStatus.AWAITING_PAYMENT
            ).update(status=ConsultationStatus.PENDING)

        _broadcast_payment(payment, kind='payment.updated')
        return Response(self.get_serializer(payment).data, status=status.HTTP_200_OK)

    @extend_schema(
        request=PaymentReviewSerializer,
        responses={200: PaymentSerializer, 400: OpenApiResponse(description='Invalid review')},
        summary='Admin or assigned lawyer: verify or reject a submitted proof of payment.',
    )
    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        """Verify or reject the latest *pending* receipt on this payment.

        Each verified receipt is posted to the trust ledger as its own
        deposit transaction (so the trust ledger total moves in step with
        what the reviewer actually approved). The parent payment's status
        rolls up to ``partial`` while some is verified, ``verified`` once
        cumulative paid ≥ amount.
        """
        from .models import PaymentReceipt

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

        target_id = request.data.get('receipt_id')
        if target_id:
            receipt = payment.receipts.filter(pk=target_id, status=PaymentStatus.PENDING_REVIEW).first()
        else:
            receipt = payment.receipts.filter(status=PaymentStatus.PENDING_REVIEW).order_by('created_at').first()

        if receipt is None:
            return Response(
                {'detail': 'No pending receipt to review on this payment.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if decision == PaymentStatus.VERIFIED and not receipt.proof_of_payment:
            return Response(
                {'detail': 'Cannot verify a receipt with no proof of payment attached.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            receipt.status = decision
            receipt.reviewed_by = request.user
            receipt.reviewed_at = timezone.now()
            receipt.review_note = note
            receipt.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'review_note'])

            if decision == PaymentStatus.VERIFIED:
                # One trust transaction per verified receipt so the ledger
                # reflects the actual installments.
                txn = TrustTransaction.objects.create(
                    matter=payment.matter,
                    transaction_type=TrustTransactionType.DEPOSIT,
                    amount=receipt.amount,
                    currency=payment.currency,
                    provider_reference=(receipt.reference or payment.reference),
                    status=TrustTransactionStatus.COMPLETED,
                )
                # Back-compat: link the first verified receipt's trust
                # transaction to the parent payment via the existing
                # OneToOneField so legacy consumers keep working.
                if payment.trust_transaction is None:
                    payment.trust_transaction = txn

            payment.reviewed_by = request.user
            payment.reviewed_at = timezone.now()
            payment.review_note = note
            payment.save(update_fields=[
                'reviewed_by', 'reviewed_at', 'review_note', 'trust_transaction', 'updated_at',
            ])
            payment.recompute_status()

        try:
            from core.audit import audit
            audit(
                actor=request.user,
                action=f'payment.{decision}',
                obj=payment,
                meta={'note': note, 'receipt_id': receipt.id, 'amount': str(receipt.amount)},
                request=request,
            )
        except Exception:
            pass
        _broadcast_payment(payment, kind='payment.updated')
        return Response(self.get_serializer(payment).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='generate-invoice')
    def generate_invoice(self, request):
        """Lawyer-only: bundle every un-invoiced billable time entry on a
        matter into a fresh invoice. Each call generates a separate Payment
        (purpose=invoice) and links those entries to it so they never
        appear on a subsequent invoice."""
        from decimal import Decimal as _D
        from django.db import transaction as _txn

        user = request.user
        if getattr(user, 'role', None) != 'lawyer':
            return Response({'detail': 'Only lawyers can raise invoices.'}, status=status.HTTP_403_FORBIDDEN)
        matter_id = request.data.get('matter')
        if not matter_id:
            return Response({'detail': 'matter is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            matter = Matter.objects.get(pk=int(matter_id))
        except (Matter.DoesNotExist, TypeError, ValueError):
            return Response({'detail': 'Matter not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not matter.lawyers.filter(pk=user.pk).exists():
            return Response(
                {'detail': 'You are not assigned to this matter.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        entries = list(
            TimeEntry.objects.filter(
                matter=matter,
                is_billable=True,
                invoice__isnull=True,
                ended_at__isnull=False,
            )
        )
        total = sum((e.amount or _D('0')) for e in entries) if entries else _D('0')
        if total <= 0:
            return Response(
                {'detail': 'No un-invoiced billable time on this matter.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with _txn.atomic():
            payment = Payment.objects.create(
                matter=matter,
                payer=matter.client,
                amount=total,
                currency='USD',
                provider='manual_pop',
                purpose=PaymentPurpose.INVOICE,
                status=PaymentStatus.PENDING_REVIEW,
                reference=f'TIME-{matter.id}-{int(timezone.now().timestamp())}',
            )
            TimeEntry.objects.filter(pk__in=[e.pk for e in entries]).update(invoice=payment)

        _broadcast_payment(payment, kind='payment.created')
        return Response(self.get_serializer(payment).data, status=status.HTTP_201_CREATED)

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
        _broadcast_payment(payment, kind='payment.updated')
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
        lawyer_profile = getattr(lawyer, 'lawyer_profile', None) if lawyer else None
        firm = getattr(lawyer_profile, 'firm', None) if lawyer_profile else None
        lawyer_name = (getattr(lawyer, 'get_full_name', lambda: '')() if lawyer else '') or (lawyer.email if lawyer else '—')
        client_name = (getattr(client, 'get_full_name', lambda: '')() if client else '') or (client.email if client else '—')
        lawyer_email = getattr(lawyer, 'email', '') if lawyer else ''
        lawyer_phone = getattr(lawyer, 'phone_number', '') if lawyer else ''
        client_email = getattr(client, 'email', '') if client else ''
        client_phone = getattr(client, 'phone_number', '') if client else ''
        bar_number = getattr(lawyer_profile, 'bar_number', '') if lawyer_profile else ''
        pc_number = getattr(lawyer_profile, 'practising_certificate_number', '') if lawyer_profile else ''
        firm_name = firm.name if firm else ''
        firm_website = firm.website if firm else ''
        firm_country = firm.country if firm else ''

        is_paid = payment.status == PaymentStatus.VERIFIED
        is_rejected = payment.status in (PaymentStatus.REJECTED, PaymentStatus.FAILED)
        status_label = 'PAID' if is_paid else ('REJECTED' if is_rejected else payment.get_status_display().upper())
        status_hex = '#059669' if is_paid else ('#b91c1c' if is_rejected else '#92400e')
        status_bg = '#ecfdf5' if is_paid else ('#fef2f2' if is_rejected else '#fffbeb')

        elements = []
        header = Table(
            [
                [Paragraph('ATTORNEY', styles['ATBrand']),
                 Paragraph(f'<font color="{status_hex}"><b>{status_label}</b></font>', styles['ATBrand'])],
                [Paragraph(firm_name or 'Law &amp; Advisory', styles['ATSmall']),
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

        # Big colored status banner — payment status is the most important line.
        verified_at_str = ''
        if is_paid and getattr(payment, 'updated_at', None):
            verified_at_str = f'Verified on {payment.updated_at.strftime("%d %b %Y")}'
        elif is_rejected and getattr(payment, 'updated_at', None):
            verified_at_str = f'Rejected on {payment.updated_at.strftime("%d %b %Y")}'

        banner_rows = [
            [Paragraph(
                f'<para alignment="center"><font color="{status_hex}" size="13"><b>{status_label}</b></font></para>',
                styles['ATValue'],
            )]
        ]
        if verified_at_str:
            banner_rows.append([Paragraph(
                f'<para alignment="center">{verified_at_str}</para>',
                styles['ATSmall'],
            )])
        banner = Table(banner_rows)
        banner.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(status_bg)),
            ('LINEABOVE', (0, 0), (-1, 0), 1, colors.HexColor(status_hex)),
            ('LINEBELOW', (0, -1), (-1, -1), 1, colors.HexColor(status_hex)),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('LEFTPADDING', (0, 0), (-1, -1), 14),
            ('RIGHTPADDING', (0, 0), (-1, -1), 14),
        ]))
        elements.append(banner)
        elements.append(Spacer(1, 14))

        # FROM / BILL TO — now includes firm details + cert numbers + phone.
        def _from_block():
            parts = [f'<b>{lawyer_name}</b>']
            if firm_name:
                parts.append(firm_name + (f' &mdash; {firm_country}' if firm_country else ''))
            if firm_website:
                parts.append(f'<i>{firm_website}</i>')
            if lawyer_email:
                parts.append(lawyer_email)
            if lawyer_phone:
                parts.append(lawyer_phone)
            cert_bits = []
            if bar_number:
                cert_bits.append(f'Bar #{bar_number}')
            if pc_number:
                cert_bits.append(f'PC #{pc_number}')
            if cert_bits:
                parts.append(' · '.join(cert_bits))
            return '<br/>'.join(parts)

        def _bill_to_block():
            parts = [f'<b>{client_name}</b>']
            if client_email:
                parts.append(client_email)
            if client_phone:
                parts.append(client_phone)
            return '<br/>'.join(parts)

        bill = Table(
            [
                [Paragraph('FROM', styles['ATEyebrow']), Paragraph('BILL TO', styles['ATEyebrow'])],
                [Paragraph(_from_block(), styles['ATValue']),
                 Paragraph(_bill_to_block(), styles['ATValue'])],
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
