from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


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


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=120)
    last_name = models.CharField(max_length=120)
    phone_number = models.CharField(max_length=32, blank=True)
    role = models.CharField(max_length=32, choices=UserRole.choices, default=UserRole.CLIENT_INDIVIDUAL)
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True)
    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_verified = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['first_name', 'last_name']

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


class LawyerProfile(models.Model):
    user = models.OneToOneField('core.User', on_delete=models.CASCADE, related_name='lawyer_profile')
    firm = models.ForeignKey(Firm, null=True, blank=True, on_delete=models.SET_NULL, related_name='lawyers')
    bar_number = models.CharField(max_length=64, blank=True)
    jurisdictions = models.JSONField(default=list, blank=True)
    practice_areas = models.JSONField(default=list, blank=True)
    languages = models.JSONField(default=list, blank=True)
    years_experience = models.PositiveIntegerField(default=0)
    hourly_rate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    consultation_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    bio = models.TextField(blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'LawyerProfile({self.user.email})'


class ClientProfile(models.Model):
    user = models.OneToOneField('core.User', on_delete=models.CASCADE, related_name='client_profile')
    business_name = models.CharField(max_length=240, blank=True)
    is_business = models.BooleanField(default=False)
    kyc_submitted = models.BooleanField(default=False)
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


class Message(models.Model):
    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey('core.User', on_delete=models.CASCADE, related_name='sent_messages')
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Message({self.sender.email})'


class ConsultationStatus(models.TextChoices):
    AWAITING_PAYMENT = 'awaiting_payment', 'Awaiting Payment'
    PENDING = 'pending', 'Pending Confirmation'
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
    file = models.FileField(upload_to=matter_document_path, null=True, blank=True)
    body = models.TextField(blank=True, help_text='Inline draft content (for drafts without a file).')
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_kind_display()}: {self.title}'


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
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-started_at']
        verbose_name_plural = 'Time entries'

    @property
    def is_running(self):
        return self.ended_at is None

    def __str__(self):
        return f'TimeEntry({self.matter.title} {self.minutes}m)'
