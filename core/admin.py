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
