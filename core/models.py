from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from .validators import validate_avatar, validate_doc


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('The Email field must be set')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('role', UserRole.ADMIN)

        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')

        return self.create_user(email, password, **extra_fields)


class UserRole(models.TextChoices):
    CLIENT_INDIVIDUAL = 'client_individual', 'Client Individual'
    CLIENT_BUSINESS = 'client_business', 'Client Business'
    LAWYER = 'lawyer', 'Lawyer'
    FIRM = 'firm', 'Firm'
    PARALEGAL = 'paralegal', 'Paralegal'
    ADMIN = 'admin', 'Platform Admin'


class TwoFactorMethod(models.TextChoices):
    OFF = 'off', 'Off'
    EMAIL = 'email', 'Email'
    WHATSAPP = 'whatsapp', 'WhatsApp'


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=120)
    last_name = models.CharField(max_length=120)
    phone_number = models.CharField(max_length=32, blank=True)
    whatsapp_number = models.CharField(max_length=32, blank=True)
    role = models.CharField(max_length=32, choices=UserRole.choices, default=UserRole.CLIENT_INDIVIDUAL)
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True, validators=[validate_avatar])
    email_verified = models.BooleanField(default=False)
    two_factor_method = models.CharField(
        max_length=16, choices=TwoFactorMethod.choices, default=TwoFactorMethod.OFF
    )
    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_verified = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['first_name', 'last_name']

    def get_full_name(self):
        return f'{self.first_name} {self.last_name}'.strip()

    def get_short_name(self):
        return self.first_name or self.email

    def __str__(self):
        return f'{self.email} ({self.role})'


class Firm(models.Model):
    name = models.CharField(max_length=240)
    slug = models.SlugField(unique=True)
    website = models.URLField(blank=True)
    description = models.TextField(blank=True)
    admin = models.ForeignKey(
        'core.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='admin_of_firms'
    )
    # ISO 3166-1 alpha-2 (e.g. "ZW", "ZA"). Used for the country flag badge.
    country = models.CharField(max_length=2, blank=True)
    default_hourly_rate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    default_consultation_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class PaymentAccountType(models.TextChoices):
    ECOCASH = 'ecocash', 'EcoCash'
    ONEMONEY = 'onemoney', 'OneMoney'
    BANK = 'bank', 'Bank'
    INNBUCKS = 'innbucks', 'InnBucks'
    OMARI = 'omari', "O'mari"
    CASH = 'cash', 'Cash'


class PaymentAccount(models.Model):
    """Where clients should send payment for a given lawyer or firm."""

    owner_user = models.ForeignKey(
        'core.User', null=True, blank=True, on_delete=models.CASCADE, related_name='payment_accounts'
    )
    owner_firm = models.ForeignKey(
        Firm, null=True, blank=True, on_delete=models.CASCADE, related_name='payment_accounts'
    )
    account_type = models.CharField(max_length=16, choices=PaymentAccountType.choices)
    identifier = models.CharField(max_length=120)
    account_name = models.CharField(max_length=240, blank=True)
    bank_name = models.CharField(max_length=120, blank=True)
    branch = models.CharField(max_length=120, blank=True)
    swift_code = models.CharField(max_length=32, blank=True)
    notes = models.CharField(max_length=240, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['account_type']

    def __str__(self):
        return f'{self.get_account_type_display()} · {self.identifier}'


class LawyerRateTier(models.Model):
    """Bar-association hourly-rate bracket. Lawyers don't set their own
    rate — it's resolved from this table by ``(country, years_experience)``.

    Country uses ISO 3166-1 alpha-2 (e.g. ``"ZW"``). An empty ``country``
    is the platform-wide default and is used as fallback when a lawyer's
    country has no rate table configured.

    Brackets are inclusive on ``min_years`` and inclusive on ``max_years``
    when set; ``max_years=NULL`` means "and above" (the top tier).
    """

    country = models.CharField(max_length=2, blank=True, db_index=True)
    min_years = models.PositiveSmallIntegerField()
    max_years = models.PositiveSmallIntegerField(null=True, blank=True)
    hourly_min = models.DecimalField(max_digits=10, decimal_places=2)
    hourly_max = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=8, default='USD')
    note = models.CharField(max_length=240, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['country', '-min_years']
        constraints = [
            models.UniqueConstraint(
                fields=['country', 'min_years'],
                name='unique_country_min_years',
            ),
        ]

    def __str__(self):
        max_label = self.max_years if self.max_years is not None else '+'
        return f'{self.country or "DEFAULT"} · {self.min_years}–{max_label}y → {self.hourly_min}–{self.hourly_max}'

    def matches(self, years: int) -> bool:
        if years < self.min_years:
            return False
        if self.max_years is None:
            return True
        return years <= self.max_years


def resolve_rate_tier(country: str, years: int):
    """Find the rate tier for ``(country, years)``. Falls back to the
    default (empty-country) table when no country-specific rule matches."""
    candidates = list(LawyerRateTier.objects.filter(country=country or ''))
    if not candidates and country:
        candidates = list(LawyerRateTier.objects.filter(country=''))
    for tier in candidates:
        if tier.matches(int(years or 0)):
            return tier
    return None


def compute_hourly_rate(country: str, years: int):
    """Midpoint hourly rate for billing/invoicing. Returns Decimal or None."""
    from decimal import Decimal

    tier = resolve_rate_tier(country, years)
    if tier is None:
        return None
    return ((tier.hourly_min + tier.hourly_max) / Decimal('2')).quantize(Decimal('0.01'))


class LawyerProfile(models.Model):
    user = models.OneToOneField('core.User', on_delete=models.CASCADE, related_name='lawyer_profile')
    firm = models.ForeignKey(Firm, null=True, blank=True, on_delete=models.SET_NULL, related_name='lawyers')
    bar_number = models.CharField(max_length=64, blank=True)
    practising_certificate_number = models.CharField(max_length=64, blank=True)
    practising_certificate_expires = models.DateField(null=True, blank=True)
    practising_certificate_file = models.FileField(upload_to='certs/', null=True, blank=True, validators=[validate_doc])
    # ISO 3166-1 alpha-2 (e.g. "ZW", "ZA"). Used for the country flag badge.
    country = models.CharField(max_length=2, blank=True)
    jurisdictions = models.JSONField(default=list, blank=True)
    practice_areas = models.JSONField(default=list, blank=True)
    languages = models.JSONField(default=list, blank=True)
    years_experience = models.PositiveIntegerField(default=0)
    # NOTE: ``hourly_rate`` is derived from ``LawyerRateTier`` by country +
    # years on every save — lawyers cannot set it manually.
    hourly_rate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    consultation_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    bio = models.TextField(blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'LawyerProfile({self.user.email})'

    def save(self, *args, **kwargs):
        # Pin the rate inside the bar-association bracket for the lawyer's
        # country + years of experience:
        #   - if no rate is set, default to the bracket midpoint;
        #   - if a rate is set, clamp it into [min, max] so a lawyer can't
        #     bill outside the prescribed scale.
        tier = resolve_rate_tier(self.country, self.years_experience)
        if tier is not None:
            lo, hi = tier.hourly_min, tier.hourly_max
            if self.hourly_rate is None:
                from decimal import Decimal as _D
                self.hourly_rate = ((lo + hi) / _D('2')).quantize(_D('0.01'))
            elif self.hourly_rate < lo:
                self.hourly_rate = lo
            elif self.hourly_rate > hi:
                self.hourly_rate = hi
        super().save(*args, **kwargs)

    @property
    def hourly_rate_band(self):
        """``(min, max)`` from the resolved tier — used by the UI to show
        the bracket alongside the midpoint rate. ``(None, None)`` if no
        tier matches."""
        tier = resolve_rate_tier(self.country, self.years_experience)
        if tier is None:
            return (None, None)
        return (tier.hourly_min, tier.hourly_max)


class KycStatus(models.TextChoices):
    UNVERIFIED = 'unverified', 'Unverified'
    PENDING = 'pending', 'Pending Review'
    VERIFIED = 'verified', 'Verified'
    REJECTED = 'rejected', 'Rejected'


class IdDocumentType(models.TextChoices):
    NATIONAL_ID = 'national_id', 'National ID'
    PASSPORT = 'passport', 'Passport'
    DRIVERS_LICENCE = 'drivers_licence', "Driver's licence"


class ClientProfile(models.Model):
    user = models.OneToOneField('core.User', on_delete=models.CASCADE, related_name='client_profile')
    business_name = models.CharField(max_length=240, blank=True)
    is_business = models.BooleanField(default=False)
    kyc_submitted = models.BooleanField(default=False)
    kyc_status = models.CharField(max_length=16, choices=KycStatus.choices, default=KycStatus.UNVERIFIED)
    id_document_type = models.CharField(max_length=24, choices=IdDocumentType.choices, blank=True)
    id_document_number = models.CharField(max_length=64, blank=True)
    id_document_file = models.FileField(upload_to='kyc/', null=True, blank=True, validators=[validate_doc])
    documents = models.JSONField(default=list, blank=True)

    def __str__(self):
        return f'ClientProfile({self.user.email})'


class MatterStatus(models.TextChoices):
    OPEN = 'open', 'Open'
    ACTIVE = 'active', 'Active'
    AWAITING_CLIENT = 'awaiting_client', 'Awaiting Client'
    CLOSED = 'closed', 'Closed'


class BillingModel(models.TextChoices):
    FIXED = 'fixed', 'Fixed Fee'
    HOURLY = 'hourly', 'Hourly'
    RETAINER = 'retainer', 'Retainer'
    CONSULTATION = 'consultation', 'Consultation'


class Matter(models.Model):
    title = models.CharField(max_length=260)
    description = models.TextField(blank=True)
    client = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='matters')
    lawyers = models.ManyToManyField('core.User', related_name='assigned_matters', blank=True)
    firm = models.ForeignKey(Firm, null=True, blank=True, on_delete=models.SET_NULL, related_name='matters')
    status = models.CharField(max_length=32, choices=MatterStatus.choices, default=MatterStatus.OPEN)
    practice_area = models.CharField(max_length=120, blank=True)
    jurisdiction = models.CharField(max_length=120, blank=True)
    billing_model = models.CharField(max_length=32, choices=BillingModel.choices, default=BillingModel.CONSULTATION)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    started_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.title


class Channel(models.Model):
    CHANNEL_TYPES = [
        ('matter', 'Matter'),
        ('dm', 'Direct Message'),
        ('group', 'Group'),
        ('firm', 'Firm'),
    ]
    channel_type = models.CharField(max_length=32, choices=CHANNEL_TYPES, default='matter')
    matter = models.ForeignKey(Matter, null=True, blank=True, on_delete=models.CASCADE, related_name='channels')
    name = models.CharField(max_length=240)
    members = models.ManyToManyField('core.User', related_name='channels')
    is_private = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class MessageKind(models.TextChoices):
    """Lightweight tagging so the chat timeline can render certain entries
    differently — e.g. a milestone is shown as a thin status divider
    instead of a chat bubble."""

    REGULAR = 'regular', 'Regular message'
    MILESTONE = 'milestone', 'Matter milestone'


class Message(models.Model):
    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='sent_messages')
    parent = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.CASCADE, related_name='replies'
    )
    content = models.TextField()
    kind = models.CharField(max_length=16, choices=MessageKind.choices, default=MessageKind.REGULAR)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Message({self.sender.email})'


class MessageReaction(models.Model):
    """An emoji reaction by a user on a message."""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='reactions')
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('message', 'user', 'emoji')]
        ordering = ['created_at']


class ConsultationStatus(models.TextChoices):
    AWAITING_PAYMENT = 'awaiting_payment', 'Awaiting Payment'
    PENDING = 'pending', 'Pending'
    CONFIRMED = 'confirmed', 'Confirmed'
    COMPLETED = 'completed', 'Completed'
    CANCELLED = 'cancelled', 'Cancelled'


class ConsultMethod(models.TextChoices):
    VIDEO = 'video', 'Video call'
    PHONE = 'phone', 'Phone call'
    IN_PERSON = 'in_person', 'In person'


class PaymentMethod(models.TextChoices):
    ONLINE = 'online', 'Online / EFT (proof of payment)'
    CASH = 'cash', 'Cash (pay in person)'


class Consultation(models.Model):
    matter = models.ForeignKey(Matter, on_delete=models.CASCADE, related_name='consultations')
    lawyer = models.ForeignKey('core.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='consultations')
    scheduled_time = models.DateTimeField()
    duration_minutes = models.PositiveIntegerField(default=30)
    mode = models.CharField(max_length=32, choices=ConsultMethod.choices, default=ConsultMethod.VIDEO)
    payment_method = models.CharField(max_length=16, choices=PaymentMethod.choices, default=PaymentMethod.ONLINE)
    practice_areas = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=32, choices=ConsultationStatus.choices, default=ConsultationStatus.PENDING)
    rate_snapshot = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    meeting_url = models.URLField(blank=True)
    notes = models.TextField(blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['scheduled_time']

    def __str__(self):
        return f'Consultation({self.matter.title})'


class TrustTransactionType(models.TextChoices):
    DEPOSIT = 'deposit', 'Deposit'
    HOLD = 'hold', 'Hold'
    RELEASE = 'release', 'Release'
    REFUND = 'refund', 'Refund'


class TrustTransactionStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    COMPLETED = 'completed', 'Completed'
    FAILED = 'failed', 'Failed'


class TrustTransaction(models.Model):
    matter = models.ForeignKey(Matter, on_delete=models.CASCADE, related_name='trust_transactions')
    transaction_type = models.CharField(max_length=32, choices=TrustTransactionType.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=8, default='USD')
    provider_reference = models.CharField(max_length=256, blank=True)
    status = models.CharField(max_length=32, choices=TrustTransactionStatus.choices, default=TrustTransactionStatus.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'TrustTransaction({self.transaction_type} {self.amount})'


class RetainerCycle(models.TextChoices):
    MONTHLY = 'monthly', 'Monthly'
    QUARTERLY = 'quarterly', 'Quarterly'
    ANNUAL = 'annual', 'Annual'


class RetainerStatus(models.TextChoices):
    ACTIVE = 'active', 'Active'
    PAUSED = 'paused', 'Paused'
    ENDED = 'ended', 'Ended'


class Retainer(models.Model):
    """An ongoing relationship: a client keeps a lawyer/firm on retainer.

    A client with an active retainer for a lawyer skips the per-consultation
    gate and can open a matter room with that lawyer directly.
    """

    client = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='retainers_as_client')
    lawyer = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='retainers_as_lawyer')
    plan_name = models.CharField(max_length=160, default='Standard retainer')
    cycle = models.CharField(max_length=16, choices=RetainerCycle.choices, default=RetainerCycle.MONTHLY)
    monthly_fee = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    included_hours = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=16, choices=RetainerStatus.choices, default=RetainerStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('client', 'lawyer')
        ordering = ['-created_at']

    def __str__(self):
        return f'Retainer({self.client.email} -> {self.lawyer.email})'


class DocumentKind(models.TextChoices):
    DOCUMENT = 'document', 'Document'
    DRAFT = 'draft', 'Draft'


def matter_document_path(instance, filename):
    return f'matter_documents/matter_{instance.matter_id}/{filename}'


class Document(models.Model):
    """A file or draft shared inside a matter room."""

    matter = models.ForeignKey(Matter, on_delete=models.CASCADE, related_name='documents')
    uploader = models.ForeignKey('core.User', on_delete=models.SET_NULL, null=True, related_name='uploaded_documents')
    title = models.CharField(max_length=240)
    kind = models.CharField(max_length=16, choices=DocumentKind.choices, default=DocumentKind.DOCUMENT)
    file = models.FileField(upload_to=matter_document_path, null=True, blank=True, validators=[validate_doc])
    body = models.TextField(blank=True, help_text='Inline draft content (for drafts without a file).')
    version = models.PositiveIntegerField(default=1)
    signed_by = models.ForeignKey(
        'core.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='signed_documents'
    )
    signed_at = models.DateTimeField(null=True, blank=True)
    signature_data = models.TextField(blank=True, help_text='Inline signature payload (base64 PNG or text).')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_kind_display()}: {self.title}'


class MatterInvite(models.Model):
    """Invitation token for a brand-new client to set a password and join a matter."""

    user = models.OneToOneField('core.User', on_delete=models.CASCADE, related_name='matter_invite')
    matter = models.ForeignKey(Matter, on_delete=models.CASCADE, related_name='invites')
    invited_by = models.ForeignKey(
        'core.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='invites_sent'
    )
    token = models.CharField(max_length=64, unique=True)
    sent_to_email = models.EmailField(blank=True)
    sent_to_phone = models.CharField(max_length=32, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class NotificationKind(models.TextChoices):
    INVITE = 'invite', 'Invite'
    BOOKING = 'booking', 'Booking'
    PAYMENT = 'payment', 'Payment'
    DOCUMENT = 'document', 'Document'
    GENERIC = 'generic', 'Generic'


class Notification(models.Model):
    """In-app notification log; also written when we 'send' an email/SMS stub."""

    recipient = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='notifications')
    kind = models.CharField(max_length=16, choices=NotificationKind.choices, default=NotificationKind.GENERIC)
    title = models.CharField(max_length=240)
    body = models.TextField(blank=True)
    link = models.CharField(max_length=240, blank=True)
    sent_email = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class AuditEvent(models.Model):
    """Append-only record of who did what to what, when. For trust & compliance."""

    actor = models.ForeignKey(
        'core.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='audit_events'
    )
    action = models.CharField(max_length=64)  # e.g. 'consultation.confirmed', 'payment.verified'
    object_type = models.CharField(max_length=64, blank=True)
    object_id = models.PositiveBigIntegerField(null=True, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['action', '-created_at']), models.Index(fields=['actor', '-created_at'])]


class LoginAttempt(models.Model):
    """Tracks failed logins per email so we can lock accounts after N failures."""

    email = models.CharField(max_length=254, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    succeeded = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class OtpPurpose(models.TextChoices):
    LOGIN = 'login', '2FA login'
    SETUP = 'setup', '2FA setup'


class OtpChallenge(models.Model):
    """A one-time code we sent via email/WhatsApp. Stored as sha256(code+salt)."""

    user = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='otp_challenges')
    token = models.CharField(max_length=64, unique=True, db_index=True)
    code_hash = models.CharField(max_length=128)
    method = models.CharField(max_length=16, choices=TwoFactorMethod.choices)
    purpose = models.CharField(max_length=16, choices=OtpPurpose.choices, default=OtpPurpose.LOGIN)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class Review(models.Model):
    """A client's star review of a lawyer, tied to a matter."""

    matter = models.ForeignKey(Matter, on_delete=models.CASCADE, related_name='reviews')
    lawyer = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='reviews_received')
    author = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='reviews_written')
    rating = models.PositiveSmallIntegerField()  # 1..5
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('matter', 'author')
        ordering = ['-created_at']

    def __str__(self):
        return f'Review({self.rating}* {self.lawyer.email})'


class TimeEntry(models.Model):
    """A billable time entry / running timer for a lawyer on a matter."""

    matter = models.ForeignKey(Matter, on_delete=models.CASCADE, related_name='time_entries')
    lawyer = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='time_entries')
    description = models.CharField(max_length=255, blank=True)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    minutes = models.PositiveIntegerField(default=0)
    rate_snapshot = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    is_billable = models.BooleanField(default=True)
    #: When a lawyer raises an invoice from /billables we link the time
    #: entries that the invoice consumes so we can compute "remaining
    #: un-invoiced" without double-billing.
    invoice = models.ForeignKey(
        'payments.Payment',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='time_entries',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-started_at']
        verbose_name_plural = 'Time entries'

    @property
    def is_running(self):
        return self.ended_at is None

    def __str__(self):
        return f'TimeEntry({self.matter.title} {self.minutes}m)'
