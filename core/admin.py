from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import (
    User,
    Firm,
    LawyerProfile,
    LawyerRateTier,
    ClientProfile,
    Matter,
    Channel,
    Message,
    Consultation,
    TrustTransaction,
    Retainer,
    Document,
    Review,
    TimeEntry,
    DeviceToken,
    AppConfig,
    SubscriptionSettings,
    Subscription,
    SubscriptionStatus,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Personal info', {'fields': ('first_name', 'last_name', 'phone_number')}),
        ('Permissions', {'fields': ('is_active', 'is_staff', 'is_superuser', 'role', 'is_verified', 'groups', 'user_permissions')}),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('email', 'first_name', 'last_name', 'password1', 'password2'),
        }),
    )
    list_display = ('email', 'first_name', 'last_name', 'role', 'is_staff', 'is_verified')
    search_fields = ('email', 'first_name', 'last_name')
    ordering = ('email',)


@admin.register(Firm)
class FirmAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'country', 'verified', 'created_at')
    list_filter = ('country', 'verified')
    search_fields = ('name', 'slug')


@admin.register(LawyerProfile)
class LawyerProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'firm', 'country', 'bar_number', 'years_experience', 'hourly_rate', 'verified_at')
    list_filter = ('country',)
    search_fields = ('user__email', 'bar_number')
    readonly_fields = ('hourly_rate',)


@admin.register(LawyerRateTier)
class LawyerRateTierAdmin(admin.ModelAdmin):
    list_display = ('country', 'min_years', 'max_years', 'hourly_min', 'hourly_max', 'currency', 'updated_at')
    list_filter = ('country', 'currency')
    search_fields = ('country', 'note')
    ordering = ('country', '-min_years')


@admin.register(ClientProfile)
class ClientProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'business_name', 'is_business', 'kyc_submitted')
    search_fields = ('user__email', 'business_name')


@admin.register(Matter)
class MatterAdmin(admin.ModelAdmin):
    list_display = ('title', 'client', 'status', 'billing_model', 'created_at')
    search_fields = ('title', 'client__email', 'practice_area', 'jurisdiction')


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    list_display = ('name', 'channel_type', 'is_private', 'created_at')
    search_fields = ('name',)


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('channel', 'sender', 'created_at')
    search_fields = ('sender__email', 'content')


@admin.register(Consultation)
class ConsultationAdmin(admin.ModelAdmin):
    list_display = ('matter', 'scheduled_time', 'status', 'price')
    search_fields = ('matter__title',)


@admin.register(TrustTransaction)
class TrustTransactionAdmin(admin.ModelAdmin):
    list_display = ('matter', 'transaction_type', 'amount', 'status', 'created_at')
    search_fields = ('matter__title', 'provider_reference')


@admin.register(Retainer)
class RetainerAdmin(admin.ModelAdmin):
    list_display = ('client', 'lawyer', 'plan_name', 'cycle', 'status', 'created_at')
    list_filter = ('status', 'cycle')
    search_fields = ('client__email', 'lawyer__email')


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ('title', 'matter', 'kind', 'uploader', 'version', 'created_at')
    list_filter = ('kind',)
    search_fields = ('title', 'matter__title')


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ('lawyer', 'author', 'rating', 'matter', 'created_at')
    list_filter = ('rating',)
    search_fields = ('lawyer__email', 'author__email')


@admin.register(TimeEntry)
class TimeEntryAdmin(admin.ModelAdmin):
    list_display = ('matter', 'lawyer', 'minutes', 'amount', 'is_billable', 'started_at', 'ended_at')
    list_filter = ('is_billable',)
    search_fields = ('matter__title', 'lawyer__email')


@admin.register(DeviceToken)
class DeviceTokenAdmin(admin.ModelAdmin):
    list_display = ('user', 'platform', 'is_active', 'last_seen_at', 'created_at')
    list_filter = ('platform', 'is_active')
    search_fields = ('user__email', 'token')


@admin.register(AppConfig)
class AppConfigAdmin(admin.ModelAdmin):
    list_display = ('web_version', 'mobile_latest_build', 'mobile_min_build', 'updated_at')

    def has_add_permission(self, request):
        return not AppConfig.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        AppConfig.load()
        return super().changelist_view(request, extra_context)


@admin.register(SubscriptionSettings)
class SubscriptionSettingsAdmin(admin.ModelAdmin):
    list_display = ('auto_check', 'monthly_fee', 'currency', 'updated_at')

    def has_add_permission(self, request):
        return not SubscriptionSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        SubscriptionSettings.load()
        return super().changelist_view(request, extra_context)


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ('user', 'period_start', 'amount', 'currency', 'status', 'created_at')
    list_filter = ('status', 'period_start')
    search_fields = ('user__email',)
    actions = ('mark_verified', 'mark_rejected')

    def _review(self, request, queryset, status):
        from django.utils import timezone
        from .notify import notify
        from .models import NotificationKind
        n = 0
        for sub in queryset:
            sub.status = status
            sub.reviewed_by = request.user
            sub.reviewed_at = timezone.now()
            sub.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'updated_at'])
            n += 1
            try:
                if status == SubscriptionStatus.VERIFIED:
                    notify(recipient=sub.user, kind=NotificationKind.PAYMENT,
                           title='Subscription active',
                           body='Your monthly subscription payment was verified — full access is restored.')
                else:
                    notify(recipient=sub.user, kind=NotificationKind.PAYMENT,
                           title='Subscription payment rejected',
                           body='Your subscription proof of payment was not accepted. Please re-upload.')
            except Exception:
                pass
        self.message_user(request, f'{n} subscription(s) updated.')

    @admin.action(description='Mark selected subscriptions VERIFIED')
    def mark_verified(self, request, queryset):
        self._review(request, queryset, SubscriptionStatus.VERIFIED)

    @admin.action(description='Mark selected subscriptions REJECTED')
    def mark_rejected(self, request, queryset):
        self._review(request, queryset, SubscriptionStatus.REJECTED)
