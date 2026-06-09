from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import (
    Firm,
    LawyerProfile,
    ClientProfile,
    Matter,
    Channel,
    Message,
    Consultation,
    ConsultMethod,
    PaymentMethod,
    TrustTransaction,
    Retainer,
    Document,
    Review,
    TimeEntry,
)

User = get_user_model()


class FirmSerializer(serializers.ModelSerializer):
    class Meta:
        model = Firm
        fields = '__all__'


class LawyerProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = LawyerProfile
        fields = [
            'id',
            'firm',
            'bar_number',
            'practising_certificate_number',
            'practising_certificate_expires',
            'country',
            'jurisdictions',
            'practice_areas',
            'languages',
            'years_experience',
            'hourly_rate',
            'consultation_price',
            'bio',
            'verified_at',
        ]


class ClientProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientProfile
        fields = [
            'id',
            'business_name',
            'is_business',
            'kyc_submitted',
            'documents',
        ]


class MiniUserSerializer(serializers.ModelSerializer):
    """Compact user representation for nesting (sender, members, lawyer)."""

    full_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'email', 'first_name', 'last_name', 'full_name', 'role', 'avatar_url']

    def get_avatar_url(self, obj):
        request = self.context.get('request')
        if not obj.avatar:
            return None
        url = obj.avatar.url
        return request.build_absolute_uri(url) if request else url

    def get_full_name(self, obj):
        return f'{obj.first_name} {obj.last_name}'.strip() or obj.email


class PaymentAccountSerializer(serializers.ModelSerializer):
    account_type_display = serializers.CharField(source='get_account_type_display', read_only=True)

    class Meta:
        from .models import PaymentAccount
        model = PaymentAccount
        fields = [
            'id', 'account_type', 'account_type_display', 'identifier', 'account_name',
            'bank_name', 'branch', 'swift_code', 'notes', 'is_active',
            'owner_user', 'owner_firm', 'created_at', 'updated_at',
        ]
        read_only_fields = ['owner_user', 'owner_firm', 'created_at', 'updated_at']


class UserSerializer(serializers.ModelSerializer):
    lawyer_profile = LawyerProfileSerializer(read_only=True)
    client_profile = ClientProfileSerializer(read_only=True)
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id',
            'email',
            'first_name',
            'last_name',
            'phone_number',
            'whatsapp_number',
            'role',
            'avatar',
            'avatar_url',
            'is_staff',
            'is_active',
            'is_verified',
            'email_verified',
            'two_factor_method',
            'date_joined',
            'lawyer_profile',
            'client_profile',
        ]
        read_only_fields = [
            'is_staff', 'is_active', 'is_verified', 'email_verified', 'two_factor_method',
            'date_joined', 'avatar_url',
        ]
        extra_kwargs = {'avatar': {'write_only': True, 'required': False}}

    def get_avatar_url(self, obj):
        request = self.context.get('request')
        if not obj.avatar:
            return None
        url = obj.avatar.url
        return request.build_absolute_uri(url) if request else url


class LawyerCardSerializer(serializers.ModelSerializer):
    """A lawyer as shown in the directory, with rate, rating and an
    `on_retainer` flag for the requesting client."""

    full_name = serializers.SerializerMethodField()
    profile = LawyerProfileSerializer(source='lawyer_profile', read_only=True)
    on_retainer = serializers.SerializerMethodField()
    hourly_rate = serializers.SerializerMethodField()
    country = serializers.SerializerMethodField()
    avg_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'email', 'first_name', 'last_name', 'full_name', 'is_verified',
            'profile', 'on_retainer', 'hourly_rate', 'country', 'avg_rating', 'review_count',
        ]

    def get_full_name(self, obj):
        return f'{obj.first_name} {obj.last_name}'.strip() or obj.email

    def get_on_retainer(self, obj):
        retained = self.context.get('retained_lawyer_ids') or set()
        return obj.id in retained

    def get_hourly_rate(self, obj):
        profile = getattr(obj, 'lawyer_profile', None)
        return str(profile.hourly_rate) if profile and profile.hourly_rate is not None else None

    def get_country(self, obj):
        profile = getattr(obj, 'lawyer_profile', None)
        return (profile.country or '') if profile else ''

    def get_avg_rating(self, obj):
        val = getattr(obj, 'avg_rating', None)
        return round(float(val), 1) if val is not None else None

    def get_review_count(self, obj):
        return getattr(obj, 'review_count', 0) or 0

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        if not (request and getattr(request.user, 'is_authenticated', False)):
            data.pop('email', None)
        return data


class FirmCardSerializer(serializers.ModelSerializer):
    """A firm shown in the directory, aggregated stats included."""

    lawyer_count = serializers.SerializerMethodField()
    practice_areas = serializers.SerializerMethodField()
    jurisdictions = serializers.SerializerMethodField()
    starting_rate = serializers.SerializerMethodField()

    class Meta:
        from .models import Firm
        model = Firm
        fields = [
            'id', 'name', 'slug', 'website', 'verified', 'country',
            'description', 'admin', 'default_hourly_rate', 'default_consultation_price',
            'lawyer_count', 'practice_areas', 'jurisdictions', 'starting_rate',
        ]

    def get_lawyer_count(self, obj):
        return obj.lawyers.count()

    def get_practice_areas(self, obj):
        seen = []
        for prof in obj.lawyers.all():
            for area in prof.practice_areas or []:
                if area not in seen:
                    seen.append(area)
        return seen

    def get_jurisdictions(self, obj):
        seen = []
        for prof in obj.lawyers.all():
            for j in prof.jurisdictions or []:
                if j not in seen:
                    seen.append(j)
        return seen

    def get_starting_rate(self, obj):
        rates = [p.hourly_rate for p in obj.lawyers.all() if p.hourly_rate is not None]
        return str(min(rates)) if rates else None


class FirmJoinSerializer(serializers.Serializer):
    firm_id = serializers.IntegerField(required=False, allow_null=True)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ['email', 'first_name', 'last_name', 'password', 'phone_number', 'role']

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User.objects.create_user(password=password, **validated_data)
        if user.role == 'lawyer':
            LawyerProfile.objects.create(user=user)
        else:
            ClientProfile.objects.create(user=user)
        return user


class MatterSerializer(serializers.ModelSerializer):
    client = MiniUserSerializer(read_only=True)
    lawyers = MiniUserSerializer(read_only=True, many=True)
    channel_id = serializers.SerializerMethodField()

    class Meta:
        model = Matter
        fields = '__all__'
        read_only_fields = ['client', 'created_at', 'updated_at']

    def get_channel_id(self, obj):
        channel = obj.channels.filter(channel_type='matter').first()
        return channel.id if channel else None


class MatterCreateSerializer(serializers.Serializer):
    """Start an engagement with a lawyer. Creates the matter room (channel) and,
    unless the client already has the lawyer on retainer, a consultation booking
    (priced from the lawyer's rate x duration; awaiting POP unless paying cash)."""

    title = serializers.CharField(max_length=260)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    practice_areas = serializers.ListField(
        child=serializers.CharField(), required=False, default=list
    )
    jurisdiction = serializers.CharField(required=False, allow_blank=True, default='')
    lawyer = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role='lawyer'))
    scheduled_time = serializers.DateTimeField(required=False, allow_null=True)
    duration_minutes = serializers.IntegerField(required=False, default=30, min_value=15, max_value=480)
    consult_method = serializers.ChoiceField(choices=ConsultMethod.choices, default=ConsultMethod.VIDEO)
    payment_method = serializers.ChoiceField(choices=PaymentMethod.choices, default=PaymentMethod.ONLINE)


class ChannelSerializer(serializers.ModelSerializer):
    members = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), many=True)

    class Meta:
        model = Channel
        fields = '__all__'


class MessageSerializer(serializers.ModelSerializer):
    sender = MiniUserSerializer(read_only=True)
    reply_count = serializers.SerializerMethodField()
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ['id', 'channel', 'sender', 'parent', 'content', 'created_at', 'reply_count', 'reactions']
        read_only_fields = ['sender', 'created_at', 'reply_count', 'reactions']

    def get_reply_count(self, obj):
        return obj.replies.count() if obj.parent_id is None else 0

    def get_reactions(self, obj):
        # Aggregate by emoji → {emoji, count, users: [user_id,...]}
        bucket: dict = {}
        for r in obj.reactions.all():
            b = bucket.setdefault(r.emoji, {'emoji': r.emoji, 'count': 0, 'user_ids': []})
            b['count'] += 1
            b['user_ids'].append(r.user_id)
        return list(bucket.values())


class ConsultationSerializer(serializers.ModelSerializer):
    lawyer_detail = MiniUserSerializer(source='lawyer', read_only=True)
    client_detail = MiniUserSerializer(source='matter.client', read_only=True)
    matter_title = serializers.CharField(source='matter.title', read_only=True)
    channel_id = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    mode_display = serializers.CharField(source='get_mode_display', read_only=True)

    class Meta:
        model = Consultation
        fields = [
            'id', 'matter', 'matter_title', 'lawyer', 'lawyer_detail', 'client_detail',
            'scheduled_time', 'duration_minutes', 'mode', 'mode_display', 'payment_method',
            'practice_areas', 'status', 'status_display', 'rate_snapshot', 'price',
            'meeting_url', 'notes', 'confirmed_at', 'channel_id', 'created_at',
        ]
        read_only_fields = ['created_at', 'confirmed_at', 'rate_snapshot', 'price']

    def get_channel_id(self, obj):
        channel = obj.matter.channels.filter(channel_type='matter').first()
        return channel.id if channel else None


class ReviewSerializer(serializers.ModelSerializer):
    author_detail = MiniUserSerializer(source='author', read_only=True)
    lawyer_detail = MiniUserSerializer(source='lawyer', read_only=True)

    class Meta:
        model = Review
        fields = [
            'id', 'matter', 'lawyer', 'author', 'author_detail', 'lawyer_detail',
            'rating', 'body', 'created_at',
        ]
        read_only_fields = ['author', 'lawyer', 'created_at']

    def validate_rating(self, value):
        if not 1 <= value <= 5:
            raise serializers.ValidationError('Rating must be between 1 and 5.')
        return value


class TimeEntrySerializer(serializers.ModelSerializer):
    matter_title = serializers.CharField(source='matter.title', read_only=True)
    client_detail = MiniUserSerializer(source='matter.client', read_only=True)
    lawyer_detail = MiniUserSerializer(source='lawyer', read_only=True)
    is_running = serializers.BooleanField(read_only=True)

    class Meta:
        model = TimeEntry
        fields = [
            'id', 'matter', 'matter_title', 'lawyer', 'lawyer_detail', 'client_detail',
            'description', 'started_at', 'ended_at', 'minutes', 'rate_snapshot',
            'amount', 'is_billable', 'is_running', 'created_at',
        ]
        read_only_fields = [
            'lawyer', 'started_at', 'ended_at', 'minutes', 'rate_snapshot', 'amount',
            'created_at', 'is_running',
        ]


class LawyerProfileEditSerializer(serializers.ModelSerializer):
    """Lawyer-editable profile (rate, areas, bio…)."""

    firm_detail = serializers.SerializerMethodField()
    practising_certificate_file_url = serializers.SerializerMethodField()

    class Meta:
        model = LawyerProfile
        fields = [
            'bar_number', 'practising_certificate_number', 'practising_certificate_expires',
            'practising_certificate_file', 'practising_certificate_file_url',
            'country', 'jurisdictions', 'practice_areas', 'languages',
            'years_experience', 'hourly_rate', 'consultation_price', 'bio',
            'firm', 'firm_detail',
        ]
        read_only_fields = ['firm', 'practising_certificate_file_url']
        extra_kwargs = {'practising_certificate_file': {'write_only': True, 'required': False, 'allow_null': True}}

    def get_practising_certificate_file_url(self, obj):
        request = self.context.get('request')
        if not obj.practising_certificate_file:
            return None
        url = obj.practising_certificate_file.url
        return request.build_absolute_uri(url) if request else url

    def get_firm_detail(self, obj):
        if obj.firm_id is None:
            return None
        return {
            'id': obj.firm.id,
            'name': obj.firm.name,
            'slug': obj.firm.slug,
            'website': obj.firm.website,
            'verified': obj.firm.verified,
        }


class ClientProfileEditSerializer(serializers.ModelSerializer):
    id_document_file_url = serializers.SerializerMethodField()
    kyc_status_display = serializers.CharField(source='get_kyc_status_display', read_only=True)

    class Meta:
        model = ClientProfile
        fields = [
            'business_name', 'is_business',
            'id_document_type', 'id_document_number', 'id_document_file',
            'id_document_file_url', 'kyc_status', 'kyc_status_display', 'kyc_submitted',
        ]
        read_only_fields = ['kyc_status', 'kyc_status_display', 'kyc_submitted', 'id_document_file_url']
        extra_kwargs = {'id_document_file': {'write_only': True, 'required': False, 'allow_null': True}}

    def get_id_document_file_url(self, obj):
        request = self.context.get('request')
        if not obj.id_document_file:
            return None
        url = obj.id_document_file.url
        return request.build_absolute_uri(url) if request else url


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        from .models import Notification
        model = Notification
        fields = ['id', 'kind', 'title', 'body', 'link', 'sent_email', 'read_at', 'created_at']


class TrustTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TrustTransaction
        fields = '__all__'
        read_only_fields = ['created_at']


class RetainerSerializer(serializers.ModelSerializer):
    lawyer_detail = MiniUserSerializer(source='lawyer', read_only=True)
    client_detail = MiniUserSerializer(source='client', read_only=True)

    class Meta:
        model = Retainer
        fields = [
            'id',
            'client',
            'lawyer',
            'client_detail',
            'lawyer_detail',
            'plan_name',
            'cycle',
            'monthly_fee',
            'included_hours',
            'status',
            'created_at',
        ]
        read_only_fields = ['client', 'created_at']


class DocumentSerializer(serializers.ModelSerializer):
    uploader_detail = MiniUserSerializer(source='uploader', read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            'id',
            'matter',
            'uploader',
            'uploader_detail',
            'title',
            'kind',
            'file',
            'file_url',
            'body',
            'version',
            'created_at',
        ]
        read_only_fields = ['uploader', 'version', 'created_at']
        extra_kwargs = {'file': {'write_only': True, 'required': False}}

    def get_file_url(self, obj):
        if not obj.file:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(obj.file.url) if request else obj.file.url


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()
