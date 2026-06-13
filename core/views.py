import math
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Avg, Count, Q, Sum
from datetime import timedelta
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from payments.models import Payment, PaymentPurpose, PaymentStatus

from .models import (
    BillingModel,
    Channel,
    ClientProfile,
    Consultation,
    ConsultationStatus,
    Document,
    Firm,
    LawyerProfile,
    Matter,
    MatterInvite,
    Message,
    Notification,
    NotificationKind,
    PaymentAccount,
    PaymentMethod,
    Retainer,
    RetainerStatus,
    Review,
    TimeEntry,
    TrustTransaction,
    UserRole,
)
from .notify import notify
from .audit import audit
from django.conf import settings as dj_settings
import secrets
from .permissions import IsAdminOrSelf
from .serializers import (
    ChannelSerializer,
    ConsultationSerializer,
    DocumentSerializer,
    FirmCardSerializer,
    LawyerCardSerializer,
    LawyerProfileEditSerializer,
    LogoutSerializer,
    MatterCreateSerializer,
    MatterSerializer,
    MessageSerializer,
    PaymentAccountSerializer,
    RegisterSerializer,
    RetainerSerializer,
    ReviewSerializer,
    TimeEntrySerializer,
    TrustTransactionSerializer,
    UserSerializer,
)

User = get_user_model()


def _is_platform_admin(user):
    return bool(getattr(user, 'is_superuser', False) or getattr(user, 'role', None) == 'admin')


def _is_lawyer(user):
    return getattr(user, 'role', None) == 'lawyer'


def _retained_lawyer_ids(user):
    if not getattr(user, 'is_authenticated', False):
        return set()
    return set(
        Retainer.objects.filter(client=user, status=RetainerStatus.ACTIVE).values_list('lawyer_id', flat=True)
    )


def _lawyer_rate(lawyer):
    profile = getattr(lawyer, 'lawyer_profile', None)
    if profile and profile.hourly_rate is not None:
        return profile.hourly_rate
    return None


def _price_for(rate, minutes):
    if rate is None:
        return None
    return (Decimal(rate) * Decimal(minutes) / Decimal(60)).quantize(Decimal('0.01'))


class RegisterAPIView(mixins.CreateModelMixin, viewsets.GenericViewSet):
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by('-date_joined')
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsAdminOrSelf]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @action(detail=False, permission_classes=[IsAuthenticated])
    def me(self, request):
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

    @action(
        detail=False,
        methods=['post', 'delete'],
        url_path='me/avatar',
        parser_classes=[MultiPartParser, FormParser],
    )
    def avatar(self, request):
        user = request.user
        if request.method == 'DELETE':
            if user.avatar:
                user.avatar.delete(save=False)
            user.avatar = None
            user.save(update_fields=['avatar'])
            return Response(UserSerializer(user, context={'request': request}).data)
        file = request.FILES.get('avatar')
        if not file:
            raise ValidationError('avatar file is required.')
        user.avatar = file
        user.save(update_fields=['avatar'])
        return Response(UserSerializer(user, context={'request': request}).data)


class MyLawyerProfileView(APIView):
    """A lawyer reads/updates their own profile (rate, practice areas, bio…)."""

    permission_classes = [IsAuthenticated]
    serializer_class = LawyerProfileEditSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def _profile(self, request):
        if not _is_lawyer(request.user):
            raise PermissionDenied('Only lawyers have an editable lawyer profile.')
        profile, _ = LawyerProfile.objects.get_or_create(user=request.user)
        return profile

    def get(self, request):
        return Response(LawyerProfileEditSerializer(self._profile(request), context={'request': request}).data)

    def patch(self, request):
        profile = self._profile(request)
        serializer = LawyerProfileEditSerializer(profile, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # When a lawyer joins a firm and has no rate, inherit firm defaults.
        if profile.firm_id and (profile.hourly_rate is None or profile.consultation_price is None):
            firm = profile.firm
            if profile.hourly_rate is None and firm.default_hourly_rate is not None:
                profile.hourly_rate = firm.default_hourly_rate
            if profile.consultation_price is None and firm.default_consultation_price is not None:
                profile.consultation_price = firm.default_consultation_price
            profile.save(update_fields=['hourly_rate', 'consultation_price'])
        return Response(LawyerProfileEditSerializer(profile, context={'request': request}).data)


class MyClientProfileView(APIView):
    """The client's own profile + KYC docs."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def _profile(self, request):
        if not (request.user.role or '').startswith('client'):
            raise PermissionDenied('Only clients have a client profile.')
        profile, _ = ClientProfile.objects.get_or_create(user=request.user)
        return profile

    def get(self, request):
        from .serializers import ClientProfileEditSerializer
        return Response(ClientProfileEditSerializer(self._profile(request), context={'request': request}).data)

    def patch(self, request):
        from .serializers import ClientProfileEditSerializer
        profile = self._profile(request)
        s = ClientProfileEditSerializer(profile, data=request.data, partial=True, context={'request': request})
        s.is_valid(raise_exception=True)
        # If they uploaded ID docs, flip status to pending.
        if 'id_document_file' in request.data or 'id_document_number' in request.data:
            s.save(kyc_status='pending', kyc_submitted=True)
        else:
            s.save()
        return Response(s.data)


class FirmViewSet(viewsets.ModelViewSet):
    """Firm directory shown alongside lawyers. Admin of a firm can edit it.
    GETs are public so the directory can be browsed before signing up."""

    serializer_class = FirmCardSerializer
    queryset = Firm.objects.all().prefetch_related('lawyers').order_by('name')
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_permissions(self):
        if self.action in {'list', 'retrieve'}:
            return [AllowAny()]
        return [IsAuthenticated()]

    def update(self, request, *args, **kwargs):  # PATCH
        firm = self.get_object()
        user = request.user
        if not (_is_platform_admin(user) or firm.admin_id == user.id):
            raise PermissionDenied('Only the firm admin can edit firm details.')
        return super().update(request, *args, **kwargs)


class PaymentAccountViewSet(viewsets.ModelViewSet):
    """A lawyer's (or firm's) payment-receiving accounts."""

    serializer_class = PaymentAccountSerializer
    permission_classes = [IsAuthenticated]
    queryset = PaymentAccount.objects.none()
    filterset_fields = ['account_type', 'owner_user', 'owner_firm']

    def _writable_qs(self, user):
        admin_firm_ids = list(Firm.objects.filter(admin=user).values_list('id', flat=True))
        return PaymentAccount.objects.filter(
            Q(owner_user=user) | Q(owner_firm_id__in=admin_firm_ids)
        )

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return PaymentAccount.objects.none()
        user = self.request.user
        # Mutations always go through the writable set the user owns/admins.
        if self.action in {'update', 'partial_update', 'destroy'}:
            return self._writable_qs(user)
        qs = PaymentAccount.objects.filter(is_active=True).order_by('account_type')
        scope = self.request.query_params.get('scope')
        matter_id = self.request.query_params.get('matter')
        if scope == 'mine':
            admin_firm_ids = list(Firm.objects.filter(admin=user).values_list('id', flat=True))
            return qs.filter(Q(owner_user=user) | Q(owner_firm_id__in=admin_firm_ids))
        if matter_id:
            matter = Matter.objects.filter(pk=matter_id).first()
            if matter is None:
                return qs.none()
            if matter.client_id != user.id and not matter.lawyers.filter(pk=user.pk).exists() and not _is_platform_admin(user):
                return qs.none()
            lawyer_ids = list(matter.lawyers.values_list('id', flat=True))
            firm_ids = list(
                LawyerProfile.objects.filter(user_id__in=lawyer_ids, firm_id__isnull=False)
                .values_list('firm_id', flat=True)
            )
            return qs.filter(Q(owner_user_id__in=lawyer_ids) | Q(owner_firm_id__in=firm_ids))
        return qs.filter(owner_user=user)

    def perform_create(self, serializer):
        user = self.request.user
        firm_id = self.request.data.get('owner_firm')
        if firm_id:
            firm = Firm.objects.filter(pk=firm_id).first()
            if firm is None or firm.admin_id != user.id:
                raise PermissionDenied('Only the firm admin can add firm payment accounts.')
            serializer.save(owner_user=None, owner_firm=firm)
        else:
            serializer.save(owner_user=user, owner_firm=None)


class JoinFirmView(APIView):
    """Lawyer joins (or leaves) a firm. POST {firm_id} to join; DELETE to leave."""

    permission_classes = [IsAuthenticated]

    def _profile(self, request):
        if not _is_lawyer(request.user):
            raise PermissionDenied('Only lawyers can join a firm.')
        profile, _ = LawyerProfile.objects.get_or_create(user=request.user)
        return profile

    def post(self, request):
        profile = self._profile(request)
        firm_id = request.data.get('firm_id')
        if firm_id is None:
            raise ValidationError('firm_id is required.')
        firm = Firm.objects.filter(pk=firm_id).first()
        if firm is None:
            raise ValidationError('Firm not found.')
        profile.firm = firm
        if profile.hourly_rate is None and firm.default_hourly_rate is not None:
            profile.hourly_rate = firm.default_hourly_rate
        if profile.consultation_price is None and firm.default_consultation_price is not None:
            profile.consultation_price = firm.default_consultation_price
        profile.save()
        return Response(FirmCardSerializer(firm).data)

    def delete(self, request):
        profile = self._profile(request)
        profile.firm = None
        profile.save(update_fields=['firm'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class LawyerViewSet(viewsets.ReadOnlyModelViewSet):
    """Lawyer directory used to choose a lawyer, with rate and star rating.
    Public so prospective clients can browse before signing up."""

    serializer_class = LawyerCardSerializer
    permission_classes = [AllowAny]
    search_fields = ['first_name', 'last_name', 'email']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return User.objects.none()
        return (
            User.objects.filter(role='lawyer')
            .select_related('lawyer_profile')
            .annotate(avg_rating=Avg('reviews_received__rating'), review_count=Count('reviews_received'))
            .order_by('first_name', 'last_name')
        )

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['retained_lawyer_ids'] = _retained_lawyer_ids(self.request.user)
        return ctx

    @action(detail=True, methods=['get'])
    def reviews(self, request, pk=None):
        lawyer = self.get_object()
        qs = Review.objects.filter(lawyer=lawyer).select_related('author')
        return Response(ReviewSerializer(qs, many=True).data)


def _lawyer_client_summaries(lawyer, request):
    """Compute the per-client roll-up used by the Clients tab list endpoint
    and the Clients detail header."""
    from django.db.models import Max

    retainer_client_ids = set(
        Retainer.objects.filter(lawyer=lawyer, status=RetainerStatus.ACTIVE)
        .values_list('client_id', flat=True)
    )
    matters_qs = Matter.objects.filter(lawyers=lawyer)
    worked_client_ids = set(matters_qs.values_list('client_id', flat=True))
    all_ids = retainer_client_ids | worked_client_ids

    matter_counts = dict(
        matters_qs.values_list('client_id').annotate(c=Count('id')).values_list('client_id', 'c')
    )
    active_counts = dict(
        matters_qs.exclude(status='closed').values_list('client_id')
        .annotate(c=Count('id')).values_list('client_id', 'c')
    )

    pay_qs = Payment.objects.filter(matter__lawyers=lawyer)
    invoiced = {
        cid: (val or Decimal('0'))
        for cid, val in pay_qs.values_list('payer_id').annotate(s=Sum('amount')).values_list('payer_id', 's')
    }
    paid = {
        cid: (val or Decimal('0'))
        for cid, val in pay_qs.filter(status=PaymentStatus.VERIFIED)
        .values_list('payer_id').annotate(s=Sum('amount')).values_list('payer_id', 's')
    }
    outstanding = {
        cid: (val or Decimal('0'))
        for cid, val in pay_qs.filter(status=PaymentStatus.PENDING_REVIEW)
        .values_list('payer_id').annotate(s=Sum('amount')).values_list('payer_id', 's')
    }
    last_consults = dict(
        Consultation.objects.filter(matter__lawyers=lawyer)
        .values_list('matter__client_id').annotate(m=Max('scheduled_time'))
        .values_list('matter__client_id', 'm')
    )

    users = User.objects.filter(pk__in=all_ids).order_by('first_name', 'last_name')
    results = []
    for u in users:
        avatar = ''
        if getattr(u, 'avatar', None):
            try:
                avatar = request.build_absolute_uri(u.avatar.url)
            except Exception:
                pass
        last_c = last_consults.get(u.id)
        results.append({
            'id': u.id,
            'email': u.email,
            'first_name': u.first_name,
            'last_name': u.last_name,
            'full_name': u.get_full_name() or u.email,
            'phone_number': getattr(u, 'phone_number', '') or '',
            'whatsapp_number': getattr(u, 'whatsapp_number', '') or '',
            'avatar_url': avatar or None,
            'relationship': 'retainer' if u.id in retainer_client_ids else 'prior_work',
            'matters_count': matter_counts.get(u.id, 0),
            'active_matters_count': active_counts.get(u.id, 0),
            'invoiced_total': str(invoiced.get(u.id, Decimal('0'))),
            'outstanding_total': str(outstanding.get(u.id, Decimal('0'))),
            'paid_total': str(paid.get(u.id, Decimal('0'))),
            'last_consultation_at': last_c.isoformat() if last_c else None,
        })
    return {'results': results, 'count': len(results)}


class MatterViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    queryset = Matter.objects.none()

    def get_serializer_class(self):
        return MatterCreateSerializer if self.action == 'create' else MatterSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Matter.objects.none()
        user = self.request.user
        base = Matter.objects.prefetch_related('lawyers', 'channels').select_related('client')
        if _is_platform_admin(user):
            return base.order_by('-created_at')
        scope = Q(client=user) | Q(lawyers=user)
        if _is_lawyer(user):
            profile = getattr(user, 'lawyer_profile', None)
            firm_id = getattr(profile, 'firm_id', None)
            if firm_id:
                scope |= Q(lawyers__lawyer_profile__firm_id=firm_id)
        return base.filter(scope).order_by('-created_at').distinct()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        lawyer = data['lawyer']
        on_retainer = lawyer.id in _retained_lawyer_ids(request.user)

        matter = Matter.objects.create(
            title=data['title'],
            description=data.get('description', ''),
            practice_area=(data.get('practice_areas') or [''])[0],
            jurisdiction=data.get('jurisdiction', ''),
            client=request.user,
            billing_model=BillingModel.RETAINER if on_retainer else BillingModel.CONSULTATION,
        )
        matter.lawyers.add(lawyer)

        channel = Channel.objects.create(channel_type='matter', matter=matter, name=data['title'])
        channel.members.add(request.user, lawyer)

        consultation = None
        payment = None
        if not on_retainer:
            rate = _lawyer_rate(lawyer)
            minutes = data.get('duration_minutes', 30)
            price = _price_for(rate, minutes)
            payment_method = data.get('payment_method', PaymentMethod.ONLINE)
            # Online bookings must clear a proof-of-payment before confirmation;
            # cash bookings go straight to awaiting lawyer confirmation.
            booking_status = (
                ConsultationStatus.AWAITING_PAYMENT
                if payment_method == PaymentMethod.ONLINE
                else ConsultationStatus.PENDING
            )
            consultation = Consultation.objects.create(
                matter=matter,
                lawyer=lawyer,
                scheduled_time=data.get('scheduled_time') or (timezone.now() + timezone.timedelta(days=1)),
                duration_minutes=minutes,
                mode=data.get('consult_method'),
                payment_method=payment_method,
                practice_areas=data.get('practice_areas') or [],
                rate_snapshot=rate,
                price=price,
                status=booking_status,
            )
            if payment_method == PaymentMethod.ONLINE and price:
                payment = Payment.objects.create(
                    matter=matter,
                    payer=request.user,
                    amount=price,
                    currency='USD',
                    provider='manual_pop',
                    purpose=PaymentPurpose.CONSULTATION,
                    status=PaymentStatus.PENDING_REVIEW,
                )

        body = MatterSerializer(matter, context=self.get_serializer_context()).data
        body['on_retainer'] = on_retainer
        body['consultation_id'] = consultation.id if consultation else None
        body['consultation'] = ConsultationSerializer(consultation).data if consultation else None
        body['payment_id'] = payment.id if payment else None
        return Response(body, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='lawyer-clients')
    def lawyer_clients(self, request):
        """Clients this lawyer can act for — retainers + every client they've
        worked with — plus aggregate stats per client (matters, invoiced,
        outstanding, paid, last activity) so the Clients screen can stay on
        a single roundtrip."""
        if not _is_lawyer(request.user):
            raise PermissionDenied('Only lawyers can list clients.')

        return Response(_lawyer_client_summaries(request.user, request))

    @action(detail=False, methods=['post'], url_path='create-for-client')
    def create_for_client(self, request):
        """Lawyer creates a matter and assigns/invites a client."""
        if not _is_lawyer(request.user):
            raise PermissionDenied('Only lawyers can create matters for clients.')

        title = (request.data.get('title') or '').strip()
        if not title:
            raise ValidationError('A title is required.')

        client_id = request.data.get('client_id')
        contact = request.data.get('contact') or {}
        invited = False
        client = None

        if client_id:
            client = User.objects.filter(pk=client_id).first()
            if client is None:
                raise ValidationError('Client not found.')
        else:
            first_name = (contact.get('first_name') or '').strip()
            last_name = (contact.get('last_name') or '').strip()
            phone = (contact.get('phone_number') or '').strip()
            email_raw = (contact.get('email') or '').strip().lower()
            if not first_name or not last_name:
                raise ValidationError('Contact requires first and last name.')
            if not phone and not email_raw:
                raise ValidationError('Contact requires either phone number or email.')

            email = email_raw or f'invite+{phone or first_name.lower()}.{last_name.lower()}.{int(timezone.now().timestamp())}@invite.attorney.local'
            existing = User.objects.filter(email__iexact=email).first()
            if existing:
                client = existing
            else:
                client = User.objects.create(
                    email=email,
                    first_name=first_name,
                    last_name=last_name,
                    phone_number=phone,
                    role=UserRole.CLIENT_INDIVIDUAL,
                    is_active=True,
                    is_verified=False,
                )
                client.set_unusable_password()
                client.save(update_fields=['password'])
                ClientProfile.objects.get_or_create(user=client)
                invited = True

        matter = Matter.objects.create(
            title=title,
            description=(request.data.get('description') or '').strip(),
            practice_area=(request.data.get('practice_area') or '').strip(),
            client=client,
            billing_model=BillingModel.RETAINER if client.id in set(
                Retainer.objects.filter(lawyer=request.user, status=RetainerStatus.ACTIVE)
                .values_list('client_id', flat=True)
            ) else BillingModel.CONSULTATION,
        )
        matter.lawyers.add(request.user)

        channel = Channel.objects.create(channel_type='matter', matter=matter, name=title)
        channel.members.add(request.user, client)

        lawyer_label = request.user.get_full_name() or request.user.email
        if invited:
            token = secrets.token_urlsafe(32)
            MatterInvite.objects.create(
                user=client,
                matter=matter,
                invited_by=request.user,
                token=token,
                sent_to_email=client.email if '@invite.attorney.local' not in client.email else '',
                sent_to_phone=getattr(client, 'phone_number', '') or '',
            )
            accept_url = f"{dj_settings.INVITE_ACCEPT_URL}?token={token}"
            notify(
                recipient=client,
                kind=NotificationKind.INVITE,
                title=f'{lawyer_label} invited you to a matter',
                body=(
                    f'{lawyer_label} opened a matter for you: "{title}".\n\n'
                    f'Set a password and join the room: {accept_url}'
                ),
                link=accept_url,
            )
        else:
            notify(
                recipient=client,
                kind=NotificationKind.GENERIC,
                title=f'{lawyer_label} opened a new matter for you',
                body=f'"{title}" is now open in your workspace.',
                link=f'/matters/{matter.id}',
            )

        audit(
            actor=request.user,
            action='matter.created_for_client',
            obj=matter,
            meta={'client_id': client.id, 'invited': invited},
            request=request,
        )
        body = MatterSerializer(matter, context=self.get_serializer_context()).data
        body['invited'] = invited
        body['client_email'] = client.email
        return Response(body, status=status.HTTP_201_CREATED)


class ChannelViewSet(viewsets.ModelViewSet):
    serializer_class = ChannelSerializer
    permission_classes = [IsAuthenticated]
    queryset = Channel.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Channel.objects.none()
        user = self.request.user
        qs = Channel.objects.prefetch_related('members')
        if _is_platform_admin(user):
            return qs
        return qs.filter(members=user).distinct()


class MessageViewSet(viewsets.ModelViewSet):
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['channel', 'parent']
    queryset = Message.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Message.objects.none()
        user = self.request.user
        qs = (
            Message.objects.select_related('sender', 'channel')
            .prefetch_related('reactions', 'replies')
            .order_by('created_at')
        )
        if _is_platform_admin(user):
            qs = qs
        else:
            qs = qs.filter(channel__members=user).distinct()
        # By default only return top-level messages so the chat thread isn't
        # cluttered with thread replies. Pass ?include_replies=1 to override.
        include_replies = self.request.query_params.get('include_replies')
        parent_qp = self.request.query_params.get('parent')
        if not include_replies and parent_qp is None:
            qs = qs.filter(parent__isnull=True)
        return qs

    def perform_create(self, serializer):
        channel = serializer.validated_data['channel']
        if not channel.members.filter(pk=self.request.user.pk).exists():
            raise PermissionDenied('You are not a member of this channel.')
        msg = serializer.save(sender=self.request.user)
        _broadcast_channel(channel.id, {'kind': 'message.created', 'message': MessageSerializer(msg).data})

    @action(detail=True, methods=['get'])
    def replies(self, request, pk=None):
        parent = self.get_object()
        qs = parent.replies.select_related('sender').prefetch_related('reactions').order_by('created_at')
        return Response(MessageSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'])
    def react(self, request, pk=None):
        from .models import MessageReaction
        message = self.get_object()
        if not message.channel.members.filter(pk=request.user.pk).exists():
            raise PermissionDenied('Not a channel member.')
        emoji = (request.data.get('emoji') or '').strip()
        if not emoji:
            raise ValidationError('emoji is required.')
        existing = MessageReaction.objects.filter(message=message, user=request.user, emoji=emoji).first()
        if existing:
            existing.delete()
            toggled = 'removed'
        else:
            MessageReaction.objects.create(message=message, user=request.user, emoji=emoji)
            toggled = 'added'
        # Drop the prefetch cache so the serializer sees the new row.
        if hasattr(message, '_prefetched_objects_cache'):
            message._prefetched_objects_cache.pop('reactions', None)
        data = MessageSerializer(message).data
        _broadcast_channel(
            message.channel_id,
            {'kind': 'message.reaction', 'message_id': message.id, 'reactions': data['reactions'], 'toggled': toggled},
        )
        return Response(data)


def _broadcast_channel(channel_id, payload):
    """Fan out a chat event over the WebSocket group for this channel."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f'channel_{channel_id}',
            {'type': 'channel.event', 'payload': payload},
        )
    except Exception:
        pass


class ConsultationViewSet(viewsets.ModelViewSet):
    queryset = Consultation.objects.none()
    serializer_class = ConsultationSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['status', 'matter', 'lawyer']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Consultation.objects.none()
        user = self.request.user
        qs = Consultation.objects.select_related('matter', 'matter__client', 'lawyer')
        if _is_platform_admin(user):
            return qs
        return qs.filter(Q(matter__client=user) | Q(lawyer=user) | Q(matter__lawyers=user)).distinct()

    def _require_lawyer_or_admin(self, consultation):
        user = self.request.user
        if not (_is_platform_admin(user) or consultation.lawyer_id == user.id):
            raise PermissionDenied('Only the assigned lawyer can change this booking.')

    @action(detail=True, methods=['post'])
    def confirm(self, request, pk=None):
        consultation = self.get_object()
        self._require_lawyer_or_admin(consultation)
        if consultation.status == ConsultationStatus.AWAITING_PAYMENT:
            raise ValidationError('Cannot confirm until proof of payment is uploaded.')
        consultation.status = ConsultationStatus.CONFIRMED
        consultation.confirmed_at = timezone.now()
        consultation.save(update_fields=['status', 'confirmed_at'])
        audit(actor=request.user, action='consultation.confirmed', obj=consultation, request=request)
        return Response(self.get_serializer(consultation).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        consultation = self.get_object()
        consultation.status = ConsultationStatus.CANCELLED
        consultation.save(update_fields=['status'])
        audit(actor=request.user, action='consultation.cancelled', obj=consultation, request=request)
        return Response(self.get_serializer(consultation).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        consultation = self.get_object()
        self._require_lawyer_or_admin(consultation)
        consultation.status = ConsultationStatus.COMPLETED
        consultation.save(update_fields=['status'])
        return Response(self.get_serializer(consultation).data)

    @action(detail=True, methods=['post'])
    def reschedule(self, request, pk=None):
        from django.utils.dateparse import parse_datetime

        consultation = self.get_object()
        raw = request.data.get('scheduled_time')
        if not raw:
            raise ValidationError('scheduled_time is required.')
        parsed = parse_datetime(raw)
        if parsed is None:
            raise ValidationError('Invalid scheduled_time.')
        if not timezone.is_aware(parsed):
            parsed = timezone.make_aware(parsed)
        note = (request.data.get('note') or '').strip()[:500]
        old_time = consultation.scheduled_time
        consultation.scheduled_time = parsed
        # Re-rescheduling resets a confirmed booking to pending so the other
        # party has to re-confirm the new slot.
        if consultation.status == ConsultationStatus.CONFIRMED:
            consultation.status = ConsultationStatus.PENDING
            consultation.confirmed_at = None
            consultation.save(update_fields=['scheduled_time', 'status', 'confirmed_at'])
        else:
            consultation.save(update_fields=['scheduled_time'])

        # Post a system-style chat message so the counter-party sees the
        # change in the matter room with the note for context.
        channel = consultation.matter.channels.filter(channel_type='matter').first()
        if channel is not None:
            old_str = old_time.strftime('%a %d %b · %H:%M') if old_time else '—'
            new_str = parsed.strftime('%a %d %b · %H:%M')
            content = f'📅 Rescheduled consultation: **{old_str} → {new_str}**'
            if note:
                content += f'\n_{note}_'
            msg = Message.objects.create(channel=channel, sender=request.user, content=content)
            _broadcast_channel(channel.id, {
                'kind': 'message.created',
                'message': MessageSerializer(msg).data,
            })

        audit(
            actor=request.user, action='consultation.rescheduled', obj=consultation,
            request=request, meta={'note': note} if note else None,
        )
        return Response(self.get_serializer(consultation).data)


class RetainerViewSet(viewsets.ModelViewSet):
    serializer_class = RetainerSerializer
    permission_classes = [IsAuthenticated]
    queryset = Retainer.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Retainer.objects.none()
        user = self.request.user
        qs = Retainer.objects.select_related('client', 'lawyer')
        if _is_platform_admin(user):
            return qs
        return qs.filter(Q(client=user) | Q(lawyer=user)).distinct()

    def perform_create(self, serializer):
        serializer.save(client=self.request.user)


class DocumentViewSet(viewsets.ModelViewSet):
    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    filterset_fields = ['matter', 'kind']
    queryset = Document.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Document.objects.none()
        user = self.request.user
        qs = Document.objects.select_related('uploader', 'matter')
        if _is_platform_admin(user):
            return qs
        return qs.filter(Q(matter__client=user) | Q(matter__lawyers=user)).distinct()

    def perform_create(self, serializer):
        doc = serializer.save(uploader=self.request.user)
        self._broadcast(doc, kind='document.created')

    @action(detail=True, methods=['post'])
    def sign(self, request, pk=None):
        doc = self.get_object()
        if doc.signed_at is not None:
            raise ValidationError('Document already signed.')
        signature_data = request.data.get('signature_data', '')
        doc.signed_by = request.user
        doc.signed_at = timezone.now()
        doc.signature_data = signature_data
        doc.save(update_fields=['signed_by', 'signed_at', 'signature_data'])
        self._broadcast(doc, kind='document.updated')
        # Notify the uploader if it's not the signer.
        if doc.uploader_id and doc.uploader_id != request.user.id:
            notify(
                recipient=doc.uploader,
                kind=NotificationKind.DOCUMENT,
                title=f'{request.user.get_full_name() or request.user.email} signed "{doc.title}"',
                body='The signature has been recorded against the matter.',
                link=f'/matters/{doc.matter_id}',
            )
        return Response(self.get_serializer(doc).data)

    def _broadcast(self, doc, *, kind):
        """Push a document event to the matter's chat channel so every open
        client refreshes its docs panel without polling."""
        channel = doc.matter.channels.filter(channel_type='matter').first()
        if channel is None:
            return
        _broadcast_channel(channel.id, {
            'kind': kind,
            'document': DocumentSerializer(doc).data,
        })


class ReviewViewSet(viewsets.ModelViewSet):
    serializer_class = ReviewSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['lawyer', 'matter']
    queryset = Review.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Review.objects.none()
        return Review.objects.select_related('author', 'lawyer', 'matter').all()

    def perform_create(self, serializer):
        matter = serializer.validated_data['matter']
        if matter.client_id != self.request.user.id:
            raise PermissionDenied('Only the matter client can review.')
        lawyer = matter.lawyers.first()
        if lawyer is None:
            raise ValidationError('This matter has no lawyer to review.')
        serializer.save(author=self.request.user, lawyer=lawyer)


class TimeEntryViewSet(viewsets.ModelViewSet):
    serializer_class = TimeEntrySerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['matter', 'is_billable']
    queryset = TimeEntry.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return TimeEntry.objects.none()
        user = self.request.user
        qs = TimeEntry.objects.select_related('matter', 'matter__client', 'lawyer')
        if _is_platform_admin(user):
            return qs
        # Lawyers see their own entries; clients see entries on their matters.
        return qs.filter(Q(lawyer=user) | Q(matter__client=user)).distinct()

    @action(detail=False, methods=['post'])
    def start(self, request):
        if not _is_lawyer(request.user):
            raise PermissionDenied('Only lawyers can track billable time.')
        matter_id = request.data.get('matter')
        matter = Matter.objects.filter(pk=matter_id, lawyers=request.user).first()
        if matter is None:
            raise ValidationError('You are not assigned to that matter.')
        running = TimeEntry.objects.filter(lawyer=request.user, ended_at__isnull=True).first()
        if running:
            raise ValidationError('Stop your running timer first.')
        entry = TimeEntry.objects.create(
            matter=matter,
            lawyer=request.user,
            description=request.data.get('description', ''),
            started_at=timezone.now(),
            rate_snapshot=_lawyer_rate(request.user),
        )
        return Response(self.get_serializer(entry).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def stop(self, request, pk=None):
        entry = self.get_object()
        if entry.lawyer_id != request.user.id and not _is_platform_admin(request.user):
            raise PermissionDenied('Not your timer.')
        if entry.ended_at is not None:
            return Response(self.get_serializer(entry).data)
        entry.ended_at = timezone.now()
        seconds = (entry.ended_at - entry.started_at).total_seconds()
        entry.minutes = max(1, math.ceil(seconds / 60))
        entry.amount = _price_for(entry.rate_snapshot, entry.minutes)
        entry.save(update_fields=['ended_at', 'minutes', 'amount'])
        return Response(self.get_serializer(entry).data)

    @action(detail=False, methods=['get'])
    def running(self, request):
        entry = TimeEntry.objects.filter(lawyer=request.user, ended_at__isnull=True).first()
        return Response(self.get_serializer(entry).data if entry else None)

    @action(detail=False, methods=['post'])
    def log(self, request):
        """Manually log a completed time entry (timesheet)."""
        if not _is_lawyer(request.user):
            raise PermissionDenied('Only lawyers can log billable time.')
        matter_id = request.data.get('matter')
        minutes = request.data.get('minutes')
        try:
            minutes = int(minutes)
        except (TypeError, ValueError):
            raise ValidationError('minutes must be an integer.')
        if minutes <= 0:
            raise ValidationError('minutes must be greater than zero.')
        matter = Matter.objects.filter(pk=matter_id, lawyers=request.user).first()
        if matter is None:
            raise ValidationError('You are not assigned to that matter.')
        started_raw = request.data.get('started_at')
        started_at = timezone.now()
        if started_raw:
            try:
                from django.utils.dateparse import parse_datetime
                parsed = parse_datetime(started_raw)
                if parsed is not None:
                    started_at = parsed if timezone.is_aware(parsed) else timezone.make_aware(parsed)
            except Exception:
                pass
        rate = _lawyer_rate(request.user)
        entry = TimeEntry.objects.create(
            matter=matter,
            lawyer=request.user,
            description=request.data.get('description', ''),
            started_at=started_at,
            ended_at=started_at + timedelta(minutes=minutes),
            minutes=minutes,
            rate_snapshot=rate,
            amount=_price_for(rate, minutes),
            is_billable=bool(request.data.get('is_billable', True)),
        )
        return Response(self.get_serializer(entry).data, status=status.HTTP_201_CREATED)


class TrustTransactionViewSet(viewsets.ModelViewSet):
    serializer_class = TrustTransactionSerializer
    permission_classes = [IsAuthenticated]
    queryset = TrustTransaction.objects.none()
    filterset_fields = ['matter']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return TrustTransaction.objects.none()
        user = self.request.user
        qs = TrustTransaction.objects.select_related('matter')
        if _is_platform_admin(user):
            return qs
        return qs.filter(Q(matter__client=user) | Q(matter__lawyers=user)).distinct()


class LawyerClientDetailView(APIView):
    """Full picture for one client: contact details + every matter,
    consultation and payment they share with this lawyer. Backs the
    Clients tab's per-client drawer."""

    permission_classes = [IsAuthenticated]

    def get(self, request, client_id):
        if not _is_lawyer(request.user):
            raise PermissionDenied('Only lawyers can view client detail.')
        try:
            cid = int(client_id)
        except (TypeError, ValueError):
            raise ValidationError('Invalid client id.')

        client = User.objects.filter(pk=cid).first()
        if client is None:
            raise NotFound('Client not found.')

        on_retainer = Retainer.objects.filter(
            client=client, lawyer=request.user, status=RetainerStatus.ACTIVE
        ).exists()
        shared_matters = Matter.objects.filter(client=client, lawyers=request.user).distinct()
        if not on_retainer and not shared_matters.exists():
            raise PermissionDenied('You have not worked with this client.')

        matters_data = MatterSerializer(
            shared_matters.order_by('-created_at'), many=True,
            context={'request': request},
        ).data
        payments_qs = Payment.objects.filter(matter__in=shared_matters).order_by('-created_at')
        payments_data = []
        for p in payments_qs.select_related('matter'):
            proof_url = ''
            if p.proof_of_payment:
                try:
                    proof_url = request.build_absolute_uri(p.proof_of_payment.url)
                except Exception:
                    pass
            payments_data.append({
                'id': p.id,
                'matter': p.matter_id,
                'matter_title': p.matter.title,
                'amount': str(p.amount),
                'currency': p.currency,
                'status': p.status,
                'status_display': p.get_status_display(),
                'purpose': p.purpose,
                'reference': p.reference or '',
                'created_at': p.created_at,
                'proof_of_payment_url': proof_url or None,
            })
        consultations_qs = Consultation.objects.filter(
            matter__in=shared_matters
        ).order_by('-scheduled_time')
        consultations_data = ConsultationSerializer(consultations_qs, many=True).data

        summary = next(
            (c for c in _lawyer_client_summaries(request.user, request)['results'] if c['id'] == cid),
            None,
        )

        return Response({
            'client': {
                'id': client.id,
                'email': client.email,
                'first_name': client.first_name,
                'last_name': client.last_name,
                'full_name': client.get_full_name() or client.email,
                'phone_number': getattr(client, 'phone_number', '') or '',
                'whatsapp_number': getattr(client, 'whatsapp_number', '') or '',
                'avatar_url': request.build_absolute_uri(client.avatar.url) if getattr(client, 'avatar', None) else None,
            },
            'summary': summary,
            'matters': matters_data,
            'payments': payments_data,
            'consultations': consultations_data,
        })


class TransactionsView(APIView):
    """Unified money ledger across all of a user's matters (payments + trust)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        admin = _is_platform_admin(user)

        payments = Payment.objects.select_related('matter')
        trust = TrustTransaction.objects.select_related('matter')
        if not admin:
            scope = Q(matter__client=user) | Q(matter__lawyers=user)
            payments = payments.filter(scope).distinct()
            trust = trust.filter(scope).distinct()

        items = []
        # Set of matter IDs where the current user is an assigned lawyer.
        assigned_matter_ids = set(
            Matter.objects.filter(lawyers=user).values_list('id', flat=True)
        )
        for p in payments:
            can_review = admin or p.matter_id in assigned_matter_ids
            proof_url = ''
            # Prefer the latest receipt's file if there is one.
            latest_receipt = p.receipts.exclude(proof_of_payment='').order_by('-created_at').first()
            if latest_receipt is not None and latest_receipt.proof_of_payment:
                proof_url = request.build_absolute_uri(latest_receipt.proof_of_payment.url)
            elif p.proof_of_payment:
                proof_url = request.build_absolute_uri(p.proof_of_payment.url)
            items.append({
                'id': f'pay-{p.id}',
                'kind': 'payment',
                'payment_id': p.id,
                'purpose': p.purpose,
                'payer_id': p.payer_id,
                'has_proof': p.has_proof,
                'proof_of_payment_url': proof_url or None,
                'can_review': can_review,
                'note': p.note or '',
                'review_note': p.review_note or '',
                'matter': p.matter_id,
                'matter_title': p.matter.title,
                'label': p.get_purpose_display(),
                'amount': str(p.amount),
                'total_paid': str(p.total_paid),
                'outstanding_amount': str(p.outstanding_amount),
                'currency': p.currency,
                'status': p.status,
                'status_display': p.get_status_display(),
                'created_at': p.created_at,
            })
        for t in trust:
            items.append({
                'id': f'trust-{t.id}',
                'kind': 'trust',
                'matter': t.matter_id,
                'matter_title': t.matter.title,
                'label': t.get_transaction_type_display(),
                'amount': str(t.amount),
                'currency': t.currency,
                'status': t.status,
                'status_display': t.get_status_display(),
                'created_at': t.created_at,
            })
        items.sort(key=lambda x: x['created_at'], reverse=True)

        total_in = sum(
            (Decimal(i['amount']) for i in items if i['kind'] == 'trust' and i['status'] == 'completed'),
            Decimal('0'),
        )
        return Response({'count': len(items), 'total_escrow': str(total_in), 'results': items})


class TransactionsExportView(APIView):
    """Same ledger as :class:`TransactionsView`, served as a CSV download
    so the user can pull a spreadsheet of every payment + trust entry,
    including a direct link to each proof-of-payment file."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        import csv
        from django.http import HttpResponse

        user = request.user
        admin = _is_platform_admin(user)

        payments = Payment.objects.select_related('matter')
        trust = TrustTransaction.objects.select_related('matter')
        if not admin:
            scope = Q(matter__client=user) | Q(matter__lawyers=user)
            payments = payments.filter(scope).distinct()
            trust = trust.filter(scope).distinct()

        rows = []
        for p in payments:
            proof_url = ''
            if p.proof_of_payment:
                proof_url = request.build_absolute_uri(p.proof_of_payment.url)
            rows.append({
                'id': f'INV-{str(p.id).zfill(5)}',
                'created_at': p.created_at.isoformat(),
                'kind': 'payment',
                'matter': p.matter.title,
                'label': p.get_purpose_display(),
                'amount': str(p.amount),
                'currency': p.currency,
                'status': p.get_status_display(),
                'reference': p.reference or '',
                'note': p.note or '',
                'review_note': p.review_note or '',
                'pop': proof_url,
            })
        for t in trust:
            rows.append({
                'id': f'TRX-{str(t.id).zfill(5)}',
                'created_at': t.created_at.isoformat(),
                'kind': 'trust',
                'matter': t.matter.title,
                'label': t.get_transaction_type_display(),
                'amount': str(t.amount),
                'currency': t.currency,
                'status': t.get_status_display(),
                'reference': '',
                'note': '',
                'review_note': '',
                'pop': '',
            })
        rows.sort(key=lambda r: r['created_at'], reverse=True)

        filename = f'transactions-{timezone.now().date().isoformat()}.csv'
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        writer = csv.writer(response)
        writer.writerow([
            'ID', 'Date', 'Kind', 'Matter', 'Label', 'Amount', 'Currency',
            'Status', 'Reference', 'Note', 'Reviewer note', 'POP',
        ])
        for r in rows:
            writer.writerow([
                r['id'], r['created_at'], r['kind'], r['matter'], r['label'],
                r['amount'], r['currency'], r['status'], r['reference'],
                r['note'], r['review_note'], r['pop'],
            ])
        return response


class CustomTokenObtainPairView(TokenObtainPairView):
    """Throttled token endpoint with simple account lockout + optional 2FA.

    After 5 failed attempts on the same email within 15 minutes the email is
    refused with 423 (Locked) for the rest of that window.

    If the resolved user has 2FA enabled, instead of returning tokens we
    return {requires_2fa: true, challenge_token, method}; the caller must POST
    /api/v1/auth/2fa/verify/ with that token + the code to receive tokens."""

    permission_classes = [AllowAny]
    throttle_scope = 'auth'

    LOCKOUT_THRESHOLD = 5
    LOCKOUT_WINDOW_MINUTES = 15

    def post(self, request, *args, **kwargs):
        from .models import LoginAttempt, TwoFactorMethod
        from .twofa import issue_challenge
        from datetime import timedelta as _td

        email = (request.data.get('email') or '').strip().lower()
        ip = request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip() or request.META.get('REMOTE_ADDR')

        if email:
            window_start = timezone.now() - _td(minutes=self.LOCKOUT_WINDOW_MINUTES)
            recent_failures = LoginAttempt.objects.filter(
                email=email, succeeded=False, created_at__gte=window_start
            ).count()
            if recent_failures >= self.LOCKOUT_THRESHOLD:
                return Response(
                    {'detail': 'Account temporarily locked. Try again in a few minutes or reset your password.'},
                    status=423,
                )

        try:
            response = super().post(request, *args, **kwargs)
        except Exception:
            if email:
                LoginAttempt.objects.create(email=email, ip_address=ip, succeeded=False)
            raise

        # Record the password-stage outcome before any 2FA branching.
        if email:
            LoginAttempt.objects.create(email=email, ip_address=ip, succeeded=response.status_code == 200)

        if response.status_code != 200:
            return response

        user = User.objects.filter(email__iexact=email).first()
        if user and user.two_factor_method != TwoFactorMethod.OFF:
            challenge = issue_challenge(user=user, method=user.two_factor_method)
            return Response(
                {
                    'requires_2fa': True,
                    'method': user.two_factor_method,
                    'challenge_token': challenge.token,
                    'detail': f'A code was sent via {user.two_factor_method}.',
                },
                status=status.HTTP_200_OK,
            )
        return response


class TwoFactorVerifyView(APIView):
    """Exchange a 2FA challenge token + code for JWTs."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = 'auth'

    def post(self, request):
        from .twofa import verify_challenge
        from .models import OtpPurpose

        token = request.data.get('challenge_token') or ''
        code = request.data.get('code') or ''
        try:
            challenge = verify_challenge(token=token, code=code)
        except ValueError as exc:
            raise ValidationError(str(exc))
        if challenge.purpose != OtpPurpose.LOGIN:
            raise ValidationError('Wrong challenge type.')
        user = challenge.user
        refresh = RefreshToken.for_user(user)
        audit(actor=user, action='auth.2fa_verified', obj=user, request=request)
        return Response({'access': str(refresh.access_token), 'refresh': str(refresh)})


class TwoFactorSetupView(APIView):
    """Begin enabling 2FA — sends a code to the chosen method to confirm reach."""

    permission_classes = [IsAuthenticated]
    throttle_scope = 'auth'

    def post(self, request):
        from .twofa import issue_challenge
        from .models import OtpPurpose, TwoFactorMethod

        method = (request.data.get('method') or '').strip().lower()
        if method not in {TwoFactorMethod.EMAIL, TwoFactorMethod.WHATSAPP}:
            raise ValidationError('method must be "email" or "whatsapp".')
        user = request.user
        if method == TwoFactorMethod.WHATSAPP:
            number = (request.data.get('whatsapp_number') or user.whatsapp_number or user.phone_number or '').strip()
            if not number:
                raise ValidationError('WhatsApp number is required.')
            user.whatsapp_number = number
            user.save(update_fields=['whatsapp_number'])
        challenge = issue_challenge(user=user, method=method, purpose=OtpPurpose.SETUP)
        return Response({'challenge_token': challenge.token, 'method': method})


class TwoFactorConfirmSetupView(APIView):
    """Verify the setup code and flip on 2FA for this user."""

    permission_classes = [IsAuthenticated]
    throttle_scope = 'auth'

    def post(self, request):
        from .twofa import verify_challenge
        from .models import OtpPurpose

        token = request.data.get('challenge_token') or ''
        code = request.data.get('code') or ''
        try:
            challenge = verify_challenge(token=token, code=code)
        except ValueError as exc:
            raise ValidationError(str(exc))
        if challenge.purpose != OtpPurpose.SETUP or challenge.user_id != request.user.id:
            raise ValidationError('Wrong challenge.')
        request.user.two_factor_method = challenge.method
        request.user.save(update_fields=['two_factor_method'])
        audit(actor=request.user, action='auth.2fa_enabled', obj=request.user, meta={'method': challenge.method}, request=request)
        return Response({'two_factor_method': challenge.method})


class TwoFactorDisableView(APIView):
    """Disable 2FA. Requires a fresh code from the currently-active method."""

    permission_classes = [IsAuthenticated]
    throttle_scope = 'auth'

    def post(self, request):
        from .twofa import verify_challenge
        from .models import TwoFactorMethod

        if request.user.two_factor_method == TwoFactorMethod.OFF:
            return Response({'two_factor_method': TwoFactorMethod.OFF})
        token = request.data.get('challenge_token') or ''
        code = request.data.get('code') or ''
        try:
            verify_challenge(token=token, code=code)
        except ValueError as exc:
            raise ValidationError(str(exc))
        request.user.two_factor_method = TwoFactorMethod.OFF
        request.user.save(update_fields=['two_factor_method'])
        audit(actor=request.user, action='auth.2fa_disabled', obj=request.user, request=request)
        return Response({'two_factor_method': TwoFactorMethod.OFF})


class CustomTokenRefreshView(TokenRefreshView):
    permission_classes = [AllowAny]
    throttle_scope = 'auth'


class RequestPasswordResetView(APIView):
    """Email a password-reset link. Always returns 200 to avoid email enumeration."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = 'password_reset'

    def post(self, request):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.http import urlsafe_base64_encode
        from django.utils.encoding import force_bytes

        email = (request.data.get('email') or '').strip().lower()
        if not email:
            raise ValidationError('email is required.')
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user:
            token = default_token_generator.make_token(user)
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            reset_url = f'{dj_settings.PASSWORD_RESET_URL}?uid={uid}&token={token}'
            notify(
                recipient=user,
                kind=NotificationKind.GENERIC,
                title='Reset your Attorney password',
                body=(
                    'We received a request to reset your password.\n\n'
                    f'Use this link to choose a new one — it expires in 24 hours:\n{reset_url}\n\n'
                    'If you did not request this, you can ignore this email.'
                ),
                link=reset_url,
            )
        return Response({'detail': 'If an account exists with that email, a reset link has been sent.'})


class ConfirmPasswordResetView(APIView):
    """Exchange a password-reset token + uid for a new password."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = 'password_reset'

    def post(self, request):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.http import urlsafe_base64_decode

        uid = request.data.get('uid') or ''
        token = request.data.get('token') or ''
        password = request.data.get('password') or ''
        if not uid or not token:
            raise ValidationError('uid and token are required.')
        if len(password) < 8:
            raise ValidationError('Password must be at least 8 characters.')
        try:
            user_id = int(urlsafe_base64_decode(uid).decode())
        except (ValueError, UnicodeDecodeError):
            raise ValidationError('Invalid reset link.')
        user = User.objects.filter(pk=user_id, is_active=True).first()
        if user is None or not default_token_generator.check_token(user, token):
            raise ValidationError('Invalid or expired reset link.')
        user.set_password(password)
        user.save(update_fields=['password'])
        refresh = RefreshToken.for_user(user)
        return Response({'access': str(refresh.access_token), 'refresh': str(refresh)})


class RequestEmailVerifyView(APIView):
    """Send a verification email to the current user."""

    permission_classes = [IsAuthenticated]
    throttle_scope = 'password_reset'

    def post(self, request):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.http import urlsafe_base64_encode
        from django.utils.encoding import force_bytes

        user = request.user
        if user.email_verified:
            return Response({'detail': 'Email already verified.'}, status=status.HTTP_200_OK)
        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        verify_url = f'{dj_settings.EMAIL_VERIFY_URL}?uid={uid}&token={token}'
        notify(
            recipient=user,
            kind=NotificationKind.GENERIC,
            title='Verify your Attorney email',
            body=(
                f'Confirm that {user.email} is yours by clicking the link below:\n{verify_url}'
            ),
            link=verify_url,
        )
        return Response({'detail': 'Verification email sent.'})


class ConfirmEmailVerifyView(APIView):
    """Public endpoint — exchange a verification uid+token to flip email_verified."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = 'password_reset'

    def post(self, request):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.http import urlsafe_base64_decode

        uid = request.data.get('uid') or ''
        token = request.data.get('token') or ''
        try:
            user_id = int(urlsafe_base64_decode(uid).decode())
        except (ValueError, UnicodeDecodeError):
            raise ValidationError('Invalid verification link.')
        user = User.objects.filter(pk=user_id, is_active=True).first()
        if user is None or not default_token_generator.check_token(user, token):
            raise ValidationError('Invalid or expired verification link.')
        if not user.email_verified:
            user.email_verified = True
            user.is_verified = True
            user.save(update_fields=['email_verified', 'is_verified'])
        return Response({'detail': 'Email verified.'})


class ExportMyDataView(APIView):
    """Return a JSON dump of everything we hold about the requesting user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        from .serializers import (
            UserSerializer,
            MatterSerializer,
            ConsultationSerializer,
            MessageSerializer,
            DocumentSerializer,
            ReviewSerializer,
            TimeEntrySerializer,
            NotificationSerializer,
            PaymentAccountSerializer,
        )
        from payments.serializers import PaymentSerializer

        ctx = {'request': request}
        my_matters = Matter.objects.filter(Q(client=user) | Q(lawyers=user)).distinct()
        my_payment_accounts = PaymentAccount.objects.filter(owner_user=user)
        my_payments = []
        try:
            from payments.models import Payment
            my_payments = Payment.objects.filter(Q(payer=user) | Q(matter__client=user) | Q(matter__lawyers=user)).distinct()
        except Exception:
            pass

        data = {
            'exported_at': timezone.now().isoformat(),
            'user': UserSerializer(user, context=ctx).data,
            'matters': MatterSerializer(my_matters, many=True, context=ctx).data,
            'consultations': ConsultationSerializer(
                Consultation.objects.filter(Q(matter__client=user) | Q(matter__lawyers=user)).distinct(),
                many=True,
            ).data,
            'messages': MessageSerializer(
                Message.objects.filter(channel__members=user).distinct().order_by('created_at'),
                many=True,
            ).data,
            'documents': DocumentSerializer(
                Document.objects.filter(Q(matter__client=user) | Q(matter__lawyers=user)).distinct(),
                many=True,
            ).data,
            'reviews': ReviewSerializer(Review.objects.filter(author=user), many=True).data,
            'time_entries': TimeEntrySerializer(TimeEntry.objects.filter(lawyer=user), many=True).data,
            'payment_accounts': PaymentAccountSerializer(my_payment_accounts, many=True).data,
            'payments': PaymentSerializer(my_payments, many=True, context=ctx).data,
            'notifications': NotificationSerializer(
                Notification.objects.filter(recipient=user).order_by('-created_at'),
                many=True,
            ).data,
        }
        audit(actor=user, action='user.data_exported', obj=user, request=request)
        return Response(data)


class DeleteMyAccountView(APIView):
    """Soft-delete the requesting user. They must POST {confirm: 'DELETE'}."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        if request.data.get('confirm') != 'DELETE':
            raise ValidationError("Type 'DELETE' to confirm.")
        # Anonymise PII; preserve referential integrity (trust ledger etc).
        original_email = user.email
        user.email = f'deleted-{user.id}@deleted.attorney.local'
        user.first_name = 'Deleted'
        user.last_name = 'User'
        user.phone_number = ''
        if user.avatar:
            user.avatar.delete(save=False)
        user.avatar = None
        user.is_active = False
        user.save()
        audit(actor=user, action='user.account_deleted', obj=user, meta={'original_email': original_email}, request=request)
        return Response({'detail': 'Account deleted.'}, status=status.HTTP_200_OK)


class LogoutView(APIView):
    """Blacklist the supplied refresh token so it can no longer be rotated."""

    permission_classes = [IsAuthenticated]
    serializer_class = LogoutSerializer

    @extend_schema(request=LogoutSerializer, responses={205: None})
    def post(self, request):
        refresh = request.data.get('refresh')
        if not refresh:
            return Response({'detail': 'A "refresh" token is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            RefreshToken(refresh).blacklist()
        except TokenError:
            return Response({'detail': 'Invalid or expired refresh token.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_205_RESET_CONTENT)


class AcceptInviteView(APIView):
    """Public endpoint — exchange an invite token + password for auth tokens."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = 'invite_accept'

    def get(self, request):
        token = request.query_params.get('token', '')
        invite = MatterInvite.objects.filter(token=token, accepted_at__isnull=True).first()
        if not invite:
            return Response({'detail': 'Invalid or expired invite.'}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            'email': invite.user.email if '@invite.attorney.local' not in invite.user.email else '',
            'first_name': invite.user.first_name,
            'last_name': invite.user.last_name,
            'phone_number': invite.user.phone_number,
            'matter_title': invite.matter.title,
        })

    def post(self, request):
        token = request.data.get('token', '')
        password = request.data.get('password', '')
        email = (request.data.get('email') or '').strip().lower()
        invite = MatterInvite.objects.filter(token=token, accepted_at__isnull=True).first()
        if not invite:
            raise ValidationError('Invalid or expired invite.')
        if not password or len(password) < 8:
            raise ValidationError('Password must be at least 8 characters.')
        user = invite.user
        if email and '@invite.attorney.local' in user.email and not User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
            user.email = email
        user.set_password(password)
        user.is_verified = True
        user.save()
        invite.accepted_at = timezone.now()
        invite.save(update_fields=['accepted_at'])
        # Issue tokens so the FE can log them in straight away.
        refresh = RefreshToken.for_user(user)
        return Response({'access': str(refresh.access_token), 'refresh': str(refresh)})


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    """In-app notifications for the current user."""

    permission_classes = [IsAuthenticated]
    queryset = Notification.objects.none()

    def get_serializer_class(self):
        from .serializers import NotificationSerializer
        return NotificationSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Notification.objects.none()
        return Notification.objects.filter(recipient=self.request.user).order_by('-created_at')

    @action(detail=False, methods=['post'], url_path='mark-all-read')
    def mark_all_read(self, request):
        Notification.objects.filter(recipient=request.user, read_at__isnull=True).update(read_at=timezone.now())
        return Response({'detail': 'OK'})

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        n = self.get_object()
        if n.read_at is None:
            n.read_at = timezone.now()
            n.save(update_fields=['read_at'])
        return Response(self.get_serializer(n).data)


class PromoteFirmAdminView(APIView):
    """Make a lawyer the admin of a firm. First-admin-wins for unclaimed firms."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        firm = Firm.objects.filter(pk=pk).first()
        if firm is None:
            raise ValidationError('Firm not found.')
        target_id = request.data.get('user_id')
        if not target_id:
            raise ValidationError('user_id is required.')
        target = User.objects.filter(pk=target_id).first()
        if target is None:
            raise ValidationError('User not found.')
        # Target must be a lawyer in this firm.
        target_profile = getattr(target, 'lawyer_profile', None)
        if not target_profile or target_profile.firm_id != firm.id:
            raise ValidationError('That lawyer is not a member of this firm.')
        # Current user must be: admin of the firm, or platform admin, or — if
        # the firm has no admin yet — a member of the firm claiming the role.
        is_admin = _is_platform_admin(request.user)
        is_current_firm_admin = firm.admin_id == request.user.id
        my_profile = getattr(request.user, 'lawyer_profile', None)
        can_claim_unclaimed = (
            firm.admin_id is None
            and my_profile
            and my_profile.firm_id == firm.id
        )
        if not (is_admin or is_current_firm_admin or can_claim_unclaimed):
            raise PermissionDenied('Only the current firm admin can transfer admin.')
        firm.admin = target
        firm.save(update_fields=['admin'])
        audit(actor=request.user, action='firm.admin_promoted', obj=firm, meta={'target_user_id': target.id}, request=request)
        notify(
            recipient=target,
            kind=NotificationKind.GENERIC,
            title=f'You are now an admin of {firm.name}',
            body='You can now manage firm details, default rates and firm-wide payment accounts.',
            link='/settings',
        )
        return Response(FirmCardSerializer(firm).data)
