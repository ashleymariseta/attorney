import math
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Avg, Count, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
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
    Consultation,
    ConsultationStatus,
    Document,
    LawyerProfile,
    Matter,
    Message,
    PaymentMethod,
    Retainer,
    RetainerStatus,
    Review,
    TimeEntry,
    TrustTransaction,
)
from .permissions import IsAdminOrSelf
from .serializers import (
    ChannelSerializer,
    ConsultationSerializer,
    DocumentSerializer,
    LawyerCardSerializer,
    LawyerProfileEditSerializer,
    LogoutSerializer,
    MatterCreateSerializer,
    MatterSerializer,
    MessageSerializer,
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

    @action(detail=False, permission_classes=[IsAuthenticated])
    def me(self, request):
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)


class MyLawyerProfileView(APIView):
    """A lawyer reads/updates their own profile (rate, practice areas, bio…)."""

    permission_classes = [IsAuthenticated]
    serializer_class = LawyerProfileEditSerializer

    def _profile(self, request):
        if not _is_lawyer(request.user):
            raise PermissionDenied('Only lawyers have an editable lawyer profile.')
        profile, _ = LawyerProfile.objects.get_or_create(user=request.user)
        return profile

    def get(self, request):
        return Response(LawyerProfileEditSerializer(self._profile(request)).data)

    def patch(self, request):
        profile = self._profile(request)
        serializer = LawyerProfileEditSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class LawyerViewSet(viewsets.ReadOnlyModelViewSet):
    """Lawyer directory used to choose a lawyer, with rate and star rating."""

    serializer_class = LawyerCardSerializer
    permission_classes = [IsAuthenticated]
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
            return base.all()
        return base.filter(Q(client=user) | Q(lawyers=user)).distinct()

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
    filterset_fields = ['channel']
    queryset = Message.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Message.objects.none()
        user = self.request.user
        qs = Message.objects.select_related('sender', 'channel').order_by('created_at')
        if _is_platform_admin(user):
            return qs
        return qs.filter(channel__members=user).distinct()

    def perform_create(self, serializer):
        channel = serializer.validated_data['channel']
        if not channel.members.filter(pk=self.request.user.pk).exists():
            raise PermissionDenied('You are not a member of this channel.')
        serializer.save(sender=self.request.user)


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
        return Response(self.get_serializer(consultation).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        consultation = self.get_object()
        consultation.status = ConsultationStatus.CANCELLED
        consultation.save(update_fields=['status'])
        return Response(self.get_serializer(consultation).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        consultation = self.get_object()
        self._require_lawyer_or_admin(consultation)
        consultation.status = ConsultationStatus.COMPLETED
        consultation.save(update_fields=['status'])
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
        serializer.save(uploader=self.request.user)


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
        for p in payments:
            items.append({
                'id': f'pay-{p.id}',
                'kind': 'payment',
                'matter': p.matter_id,
                'matter_title': p.matter.title,
                'label': p.get_purpose_display(),
                'amount': str(p.amount),
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


class CustomTokenObtainPairView(TokenObtainPairView):
    permission_classes = [AllowAny]


class CustomTokenRefreshView(TokenRefreshView):
    permission_classes = [AllowAny]


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
