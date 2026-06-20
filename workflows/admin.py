from django.contrib import admin, messages

from . import credits
from .models import (
    AICreditAccount,
    AICreditOrder,
    AICreditPlan,
    AICreditTransaction,
    AIPlatformSettings,
    CreditOrderStatus,
    LLMProviderConfig,
    LLMUsageLog,
    LLMUserQuota,
    PrecedentTemplate,
    StageResult,
    Workflow,
    WorkflowDocument,
    WorkflowStage,
    WorkflowTemplate,
)


@admin.register(WorkflowTemplate)
class WorkflowTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'matter_type', 'is_active', 'created_at')
    list_filter = ('is_active', 'matter_type')
    search_fields = ('name', 'slug', 'matter_type')


@admin.register(Workflow)
class WorkflowAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'template', 'matter', 'status', 'created_at')
    list_filter = ('status',)
    search_fields = ('name', 'owner__email', 'template__name')


@admin.register(WorkflowStage)
class WorkflowStageAdmin(admin.ModelAdmin):
    list_display = ('workflow', 'order', 'title', 'provider', 'status', 'approved_at')
    list_filter = ('status', 'provider')
    search_fields = ('workflow__name', 'title')


@admin.register(StageResult)
class StageResultAdmin(admin.ModelAdmin):
    list_display = ('stage', 'provider', 'model', 'tokens_in', 'tokens_out', 'created_at')
    list_filter = ('provider',)
    search_fields = ('stage__workflow__name', 'stage__title')


@admin.register(LLMProviderConfig)
class LLMProviderConfigAdmin(admin.ModelAdmin):
    """Platform-wide LLM provider configuration.

    Providers are no longer set per lawyer in the app. Create one config here,
    tick ``is_default``, and every lawyer's AI workflow runs use it. Only one
    config per provider may be the default; saving a new default clears the
    flag on the others automatically.
    """

    list_display = ('provider', 'label', 'default_model', 'is_default', 'owner', 'updated_at')
    list_filter = ('provider', 'is_default')
    search_fields = ('owner__email', 'label')

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        if 'owner' in form.base_fields:
            # Owner is bookkeeping only now; default it to the current admin.
            form.base_fields['owner'].required = False
        return form

    def save_model(self, request, obj, form, change):
        # Default the owner to whoever sets it up in the admin.
        if obj.owner_id is None:
            obj.owner = request.user
        super().save_model(request, obj, form, change)
        if obj.is_default:
            # Exactly one global default per provider.
            LLMProviderConfig.objects.filter(provider=obj.provider).exclude(
                pk=obj.pk
            ).update(is_default=False)


@admin.register(LLMUsageLog)
class LLMUsageLogAdmin(admin.ModelAdmin):
    list_display = ('owner', 'provider', 'model', 'tokens_in', 'tokens_out', 'pool', 'created_at')
    list_filter = ('provider', 'pool')
    search_fields = ('owner__email', 'model')
    date_hierarchy = 'created_at'


@admin.register(LLMUserQuota)
class LLMUserQuotaAdmin(admin.ModelAdmin):
    """Per-user AI usage throttles. Leave a field blank to inherit the platform
    default (AI platform settings). Set a token quota to 0 to make that window
    unlimited for the user. ``is_pool_disabled`` blocks AI entirely."""

    list_display = (
        'owner', 'daily_token_quota', 'weekly_token_quota', 'monthly_token_quota',
        'rate_limit_per_minute', 'is_pool_disabled', 'updated_at',
    )
    list_filter = ('is_pool_disabled',)
    search_fields = ('owner__email',)


# ---------------------------------------------------------------------------
# AI platform settings (singleton) + AI credits / subscriptions
# ---------------------------------------------------------------------------

@admin.register(AIPlatformSettings)
class AIPlatformSettingsAdmin(admin.ModelAdmin):
    """The platform-wide AI usage throttles (per lawyer). Single row — these
    are the defaults; per-user overrides live in LLM user quotas."""

    list_display = (
        'daily_token_quota', 'weekly_token_quota', 'monthly_token_quota',
        'rate_limit_per_minute', 'free_tier_credits', 'updated_at',
    )

    def has_add_permission(self, request):
        # Singleton: only allow the first (auto-created) row.
        return not AIPlatformSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        AIPlatformSettings.load()  # ensure the singleton exists
        return super().changelist_view(request, extra_context)


@admin.register(AICreditPlan)
class AICreditPlanAdmin(admin.ModelAdmin):
    list_display = ('name', 'token_credits', 'price', 'currency', 'period', 'is_active')
    list_filter = ('period', 'is_active', 'currency')
    search_fields = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}


class AICreditTransactionInline(admin.TabularInline):
    model = AICreditTransaction
    extra = 0
    can_delete = False
    fields = ('created_at', 'kind', 'amount', 'balance_after', 'order', 'note', 'actor')
    readonly_fields = fields
    ordering = ('-created_at',)

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(AICreditAccount)
class AICreditAccountAdmin(admin.ModelAdmin):
    """A firm or lawyer's prepaid AI token balance. Balance is derived from the
    ledger — adjust it by adding an order or via the 'adjust' action, not by
    editing this row."""

    list_display = ('owner_label', 'balance', 'free_tier_granted', 'lifetime_granted', 'lifetime_spent', 'updated_at')
    search_fields = ('owner_user__email', 'owner_firm__name')
    readonly_fields = ('balance', 'free_tier_granted', 'lifetime_granted', 'lifetime_spent', 'created_at', 'updated_at')
    inlines = [AICreditTransactionInline]

    @admin.display(description='Account')
    def owner_label(self, obj):
        return obj.owner_label


@admin.register(AICreditOrder)
class AICreditOrderAdmin(admin.ModelAdmin):
    """Proof-of-payment verification queue. Select pending orders and run
    'Verify & grant credits' to unlock the credits on the owner's account."""

    list_display = (
        'created_at', 'owner_label', 'plan', 'token_credits', 'amount', 'currency',
        'status', 'created_by', 'reviewed_by',
    )
    list_filter = ('status', 'currency', 'method')
    search_fields = ('owner_user__email', 'owner_firm__name', 'created_by__email', 'reference')
    autocomplete_fields = ()
    readonly_fields = ('created_by', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at')
    actions = ('verify_and_grant', 'reject_orders')

    @admin.display(description='Account')
    def owner_label(self, obj):
        return obj.owner_label

    def get_changeform_initial_data(self, request):
        return {'status': CreditOrderStatus.PENDING}

    def save_model(self, request, obj, form, change):
        # Convenience: default credits from the chosen plan if left blank.
        if obj.plan_id and not obj.token_credits:
            obj.token_credits = obj.plan.token_credits
        if obj.plan_id and (obj.amount is None):
            obj.amount = obj.plan.price
        super().save_model(request, obj, form, change)

    @admin.action(description='Verify & grant credits')
    def verify_and_grant(self, request, queryset):
        granted = skipped = 0
        for order in queryset:
            if order.status == CreditOrderStatus.VERIFIED:
                skipped += 1
                continue
            try:
                credits.verify_order(order, reviewer=request.user, note='Verified in admin')
                granted += 1
            except Exception as e:  # noqa: BLE001 — surface any failure to the admin
                self.message_user(request, f'Order #{order.pk}: {e}', level=messages.ERROR)
        if granted:
            self.message_user(request, f'Verified {granted} order(s) and granted credits.', level=messages.SUCCESS)
        if skipped:
            self.message_user(request, f'Skipped {skipped} already-verified order(s).', level=messages.WARNING)

    @admin.action(description='Reject selected orders')
    def reject_orders(self, request, queryset):
        rejected = skipped = 0
        for order in queryset:
            if order.status == CreditOrderStatus.VERIFIED:
                skipped += 1
                continue
            credits.reject_order(order, reviewer=request.user, note='Rejected in admin')
            rejected += 1
        if rejected:
            self.message_user(request, f'Rejected {rejected} order(s).', level=messages.SUCCESS)
        if skipped:
            self.message_user(request, f'Skipped {skipped} verified order(s) — refund instead.', level=messages.WARNING)


@admin.register(AICreditTransaction)
class AICreditTransactionAdmin(admin.ModelAdmin):
    """Read-only AI credit ledger."""

    list_display = ('created_at', 'account', 'kind', 'amount', 'balance_after', 'order', 'actor')
    list_filter = ('kind',)
    search_fields = ('account__owner_user__email', 'account__owner_firm__name', 'note')
    date_hierarchy = 'created_at'
    readonly_fields = ('account', 'kind', 'amount', 'balance_after', 'order', 'usage_log', 'actor', 'note', 'created_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PrecedentTemplate)
class PrecedentTemplateAdmin(admin.ModelAdmin):
    """Document precedents (Markdown with {{placeholders}}). Define the fillable
    fields in ``variables`` as a list of {key, label, help, required, type}."""

    list_display = ('name', 'category', 'matter_type', 'workflow_template', 'is_active', 'updated_at')
    list_filter = ('is_active', 'category', 'matter_type')
    search_fields = ('name', 'slug', 'description')
    prepopulated_fields = {'slug': ('name',)}


@admin.register(WorkflowDocument)
class WorkflowDocumentAdmin(admin.ModelAdmin):
    list_display = ('title', 'owner', 'precedent', 'status', 'sent_matter', 'updated_at')
    list_filter = ('status',)
    search_fields = ('title', 'owner__email')
    readonly_fields = ('sent_matter', 'sent_document', 'sent_at', 'created_at', 'updated_at')
