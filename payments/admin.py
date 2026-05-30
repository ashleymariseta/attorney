from django.contrib import admin
from django.utils import timezone

from core.models import TrustTransaction, TrustTransactionStatus, TrustTransactionType

from .models import Payment, PaymentStatus


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'matter',
        'payer',
        'provider',
        'purpose',
        'amount',
        'currency',
        'status',
        'has_proof',
        'created_at',
    )
    list_filter = ('status', 'provider', 'purpose', 'currency')
    search_fields = ('reference', 'matter__title', 'payer__email')
    readonly_fields = ('created_at', 'updated_at', 'reviewed_at', 'trust_transaction')
    actions = ('verify_payments', 'reject_payments')

    @admin.display(boolean=True, description='POP')
    def has_proof(self, obj):
        return obj.has_proof

    @admin.action(description='Verify selected payments (post to trust ledger)')
    def verify_payments(self, request, queryset):
        verified = 0
        for payment in queryset.exclude(status=PaymentStatus.VERIFIED):
            if not payment.has_proof:
                continue
            payment.mark_reviewed(reviewer=request.user, status=PaymentStatus.VERIFIED)
            if payment.trust_transaction is None:
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
            verified += 1
        self.message_user(request, f'{verified} payment(s) verified.')

    @admin.action(description='Reject selected payments')
    def reject_payments(self, request, queryset):
        updated = queryset.update(
            status=PaymentStatus.REJECTED,
            reviewed_by=request.user,
            reviewed_at=timezone.now(),
        )
        self.message_user(request, f'{updated} payment(s) rejected.')
