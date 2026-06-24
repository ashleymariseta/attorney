from collections import namedtuple

from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from rest_framework.parsers import FormParser, JSONParser, MultiPartParser

from . import credits
from .credits import InsufficientCreditsError
from .models import (
    AICreditOrder,
    AICreditPlan,
    AIPlatformSettings,
    ContractReview,
    ContractReviewStatus,
    CreditOrderStatus,
    LLMProvider,
    LLMProviderConfig,
    LLMUsageLog,
    LLMUserQuota,
    PrecedentTemplate,
    StageResult,
    StageStatus,
    Workflow,
    WorkflowDocument,
    WorkflowStage,
    WorkflowTemplate,
)
from .precedents import (
    TEMPLATE_SYSTEM_PROMPT,
    parse_generated_template,
    render_precedent,
)
from .providers import ProviderError, get_provider, pool_config
from .serializers import (
    AICreditAccountSerializer,
    AICreditOrderCreateSerializer,
    AICreditOrderSerializer,
    AICreditPlanSerializer,
    ContractReviewListSerializer,
    ContractReviewSerializer,
    PrecedentTemplateListSerializer,
    PrecedentTemplateSerializer,
    StageResultSerializer,
    WorkflowDocumentCreateSerializer,
    WorkflowDocumentSerializer,
    WorkflowCreateSerializer,
    WorkflowDetailSerializer,
    WorkflowListSerializer,
    WorkflowStageSerializer,
    WorkflowTemplateSerializer,
)


def _is_lawyer(user):
    """Workflows are a lawyer-only product surface for now."""
    return getattr(user, 'role', None) == 'lawyer'


# ---- LLM gateway -----------------------------------------------------------

class QuotaError(Exception):
    """Raised when a pool-key call would breach the tenant's rate limit or
    monthly token quota. Bubbled to the API as a 429."""


def _tenant_pseudo_id(user) -> str:
    """Stable, opaque per-user identifier for provider-side abuse tracking.
    Hashed with the Django SECRET_KEY so it leaks nothing if logs surface.
    """
    import hashlib
    from django.conf import settings as dj_settings

    h = hashlib.sha256()
    h.update(str(dj_settings.SECRET_KEY).encode('utf-8'))
    h.update(b':llm-tenant:')
    h.update(str(getattr(user, 'id', '')).encode('utf-8'))
    return f'tenant_{h.hexdigest()[:24]}'


UserQuota = namedtuple('UserQuota', 'daily weekly monthly rate disabled')


def _user_quota(user) -> 'UserQuota':
    """Resolve the user's effective throttles: per-user override row if present,
    otherwise the platform defaults from the AIPlatformSettings singleton (set
    in Django admin). A ``0`` token quota means that window is unlimited."""
    cfg = AIPlatformSettings.load()
    row = LLMUserQuota.objects.filter(owner=user).first()
    daily = cfg.daily_token_quota
    weekly = cfg.weekly_token_quota
    monthly = cfg.monthly_token_quota
    rate = cfg.rate_limit_per_minute
    disabled = False
    if row:
        if row.daily_token_quota is not None:
            daily = row.daily_token_quota
        if row.weekly_token_quota is not None:
            weekly = row.weekly_token_quota
        if row.monthly_token_quota is not None:
            monthly = row.monthly_token_quota
        if row.rate_limit_per_minute is not None:
            rate = row.rate_limit_per_minute
        disabled = row.is_pool_disabled
    return UserQuota(daily=daily, weekly=weekly, monthly=monthly, rate=rate, disabled=disabled)


def _tokens_since(user, since) -> int:
    """Total tokens (in + out) the user has spent on the shared key since
    ``since``. Errored calls log 0 tokens so they don't count against quota."""
    from django.db.models import Sum

    agg = LLMUsageLog.objects.filter(
        owner=user, pool=True, created_at__gte=since
    ).aggregate(total=Sum('tokens_in') + Sum('tokens_out'))
    return agg['total'] or 0


def _enforce_pool_limits(user) -> None:
    """Check rate + day/week/month token quotas *before* a shared-key call.
    Raises :class:`QuotaError` with a clear message on the first breach.

    Windows stack: the tightest one that trips wins. A quota of 0 disables
    that window."""
    from datetime import timedelta
    from django.utils import timezone as tz

    q = _user_quota(user)
    if q.disabled:
        raise QuotaError('Your access to the AI provider has been disabled by an administrator.')

    now = tz.now()
    minute_ago = now - timedelta(minutes=1)
    recent = LLMUsageLog.objects.filter(owner=user, pool=True, created_at__gte=minute_ago).count()
    if q.rate and recent >= q.rate:
        raise QuotaError(f'Rate limit reached ({q.rate}/min). Try again in a moment.')

    # Calendar-aligned windows: midnight today, Monday of this ISO week, 1st of month.
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = day_start - timedelta(days=now.weekday())
    month_start = day_start.replace(day=1)

    for label, period, quota, since in (
        ('Daily', 'day', q.daily, day_start),
        ('Weekly', 'week', q.weekly, week_start),
        ('Monthly', 'month', q.monthly, month_start),
    ):
        if quota and _tokens_since(user, since) >= quota:
            raise QuotaError(
                f'{label} AI token quota reached ({quota:,}). It resets at the start of the next {period}.'
            )


def _log_usage(user, config, completion=None, error: str = '') -> None:
    """Persist one LLMUsageLog row after every provider call so the admin
    dashboard shows full attribution and the quota windows have data to sum.

    ``pool=True`` marks a call as served by the shared platform key (and thus
    metered). With BYOK removed, every call is metered, so we default to True.
    """
    is_pool = getattr(config, 'is_pool', True)
    return LLMUsageLog.objects.create(
        owner=user,
        provider=config.provider,
        model=(completion.model if completion else (getattr(config, 'default_model', '') or '')),
        tokens_in=(completion.tokens_in if completion else 0),
        tokens_out=(completion.tokens_out if completion else 0),
        pool=is_pool,
        error=error[:240],
    )


class WorkflowTemplateViewSet(viewsets.ReadOnlyModelViewSet):
    """Public-to-lawyers catalogue of available matter-type templates."""

    serializer_class = WorkflowTemplateSerializer
    permission_classes = [IsAuthenticated]
    queryset = WorkflowTemplate.objects.filter(is_active=True)


class WorkflowViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    queryset = Workflow.objects.none()
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return Workflow.objects.none()
        return Workflow.objects.filter(owner=self.request.user).select_related('template')

    def get_serializer_class(self):
        if self.action == 'create':
            return WorkflowCreateSerializer
        if self.action == 'retrieve':
            return WorkflowDetailSerializer
        return WorkflowListSerializer

    def create(self, request, *args, **kwargs):
        if not _is_lawyer(request.user):
            return Response(
                {'detail': 'Only practitioners can start workflows.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            wf = ser.save()
        out = WorkflowDetailSerializer(wf).data
        return Response(out, status=status.HTTP_201_CREATED)


class WorkflowStageViewSet(viewsets.ModelViewSet):
    serializer_class = WorkflowStageSerializer
    permission_classes = [IsAuthenticated]
    queryset = WorkflowStage.objects.none()
    # 'post' is required for the run/ and approve/ detail actions.
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return WorkflowStage.objects.none()
        return WorkflowStage.objects.filter(workflow__owner=self.request.user).select_related('workflow')

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Mark this stage approved by the practitioner — gate for downstream
        stages to proceed."""
        stage = self.get_object()
        stage.status = StageStatus.APPROVED
        stage.approved_by = request.user
        stage.approved_at = timezone.now()
        stage.save(update_fields=['status', 'approved_by', 'approved_at'])
        return Response(WorkflowStageSerializer(stage).data)

    @action(detail=True, methods=['post'])
    def run(self, request, pk=None):
        """Call the configured LLM provider with the stage's prompt and
        record the result. The practitioner edits the prompt freely on each
        run; the saved ``prompt_template`` is used as a default only."""
        stage = self.get_object()
        system_prompt = request.data.get('system_prompt') or stage.purpose or ''
        user_prompt = request.data.get('user_prompt') or stage.prompt_template or ''

        config = _pick_provider_config(stage.provider)
        if config is None:
            return Response(
                {'detail': 'No AI provider has been configured by the administrator yet.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Credits are the hard gate: atomically reserve up-front so concurrent
        # runs can't overspend a balance. The per-minute rate and day/week/month
        # token quotas throttle on top. Both are validated synchronously so the
        # caller gets an immediate 402/429; the (slow) provider call then runs in
        # a Celery worker, which reconciles the hold to actual usage.
        try:
            hold = credits.begin_charge(request.user)
        except InsufficientCreditsError as c:
            return Response({'detail': str(c)}, status=status.HTTP_402_PAYMENT_REQUIRED)

        try:
            _enforce_pool_limits(request.user)
        except QuotaError as q:
            credits.release_charge(request.user, hold, 0, note='quota throttle — no run')
            return Response({'detail': str(q)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        model = request.data.get('model') or stage.model or config.default_model
        stage.status = StageStatus.IN_PROGRESS
        stage.save(update_fields=['status'])

        from .tasks import run_stage_task
        run_stage_task.delay(
            stage.id, request.user.id, system_prompt, user_prompt, model or '', hold,
        )

        stage.refresh_from_db()  # eager mode (dev/tests) already produced the result
        return Response(WorkflowStageSerializer(stage).data, status=status.HTTP_202_ACCEPTED)


def _pick_provider_config(provider=None):
    """Resolve the single platform-wide provider config.

    Providers are no longer configured per-lawyer. An administrator sets one
    up in the Django admin and every lawyer's AI run uses it. When ``provider``
    is given (a workflow stage declares one) we prefer a config for it, but
    always fall back to the global default so a stage never fails just because
    it named a provider the admin didn't configure. Order within each scope:
    ``is_default`` first, then most recently updated. Finally the settings
    pool key. Returns ``None`` only when nothing at all is configured.
    """
    qs = LLMProviderConfig.objects.all()
    cfg = None
    if provider:
        cfg = (
            qs.filter(provider=provider, is_default=True).order_by('-updated_at').first()
            or qs.filter(provider=provider).order_by('-updated_at').first()
        )
    if cfg is None:
        cfg = (
            qs.filter(is_default=True).order_by('-updated_at').first()
            or qs.order_by('-updated_at').first()
        )
    if cfg is not None:
        return cfg
    for p in ([provider] if provider else []) + ['anthropic', 'openai', 'local']:
        pool = pool_config(p)
        if pool is not None:
            return pool
    return None


def _is_platform_admin(user) -> bool:
    return bool(
        getattr(user, 'is_superuser', False)
        or getattr(user, 'is_staff', False)
        or getattr(user, 'role', None) == 'admin'
    )


class LLMUsageAdminView(viewsets.ViewSet):
    """Platform-admin view of LLM usage across all tenants. Two endpoints:

    * ``GET /api/v1/llm-usage/`` — current month, one row per user with
      total tokens (pool vs BYOK split) and last activity.
    * ``GET /api/v1/llm-usage/me/`` — same shape but scoped to the caller.
      Available to every lawyer so they can see their own pool spend.
    """

    permission_classes = [IsAuthenticated]

    def list(self, request):
        if not _is_platform_admin(request.user):
            return Response({'detail': 'Platform admin only.'}, status=status.HTTP_403_FORBIDDEN)
        return Response(_usage_summary(scope_user=None))

    @action(detail=False, methods=['get'])
    def me(self, request):
        return Response(_usage_summary(scope_user=request.user))


def _usage_summary(scope_user) -> dict:
    """Aggregate the current month's usage. When ``scope_user`` is None,
    returns every user with activity; otherwise just that user's row."""
    from django.contrib.auth import get_user_model
    from django.db.models import Sum, Max
    from django.utils import timezone as tz

    month_start = tz.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    qs = LLMUsageLog.objects.filter(created_at__gte=month_start)
    if scope_user is not None:
        qs = qs.filter(owner=scope_user)

    rows: dict[int, dict] = {}
    aggs = (
        qs.values('owner_id', 'pool')
        .annotate(tokens_in=Sum('tokens_in'), tokens_out=Sum('tokens_out'), last=Max('created_at'))
    )
    for a in aggs:
        r = rows.setdefault(a['owner_id'], {
            'user_id': a['owner_id'],
            'pool_tokens': 0,
            'byok_tokens': 0,
            'last_used': None,
        })
        tokens = (a['tokens_in'] or 0) + (a['tokens_out'] or 0)
        if a['pool']:
            r['pool_tokens'] += tokens
        else:
            r['byok_tokens'] += tokens
        if a['last'] and (r['last_used'] is None or a['last'] > r['last_used']):
            r['last_used'] = a['last']

    # Hydrate the user fields + their quota.
    User = get_user_model()
    user_map = {u.id: u for u in User.objects.filter(pk__in=rows.keys())}
    out = []
    for uid, r in rows.items():
        u = user_map.get(uid)
        if u is None:
            continue
        q = _user_quota(u)
        out.append({
            **r,
            'email': u.email,
            'full_name': u.get_full_name() or u.email,
            'role': getattr(u, 'role', ''),
            'daily_quota': q.daily,
            'weekly_quota': q.weekly,
            'monthly_quota': q.monthly,
            'rate_limit_per_minute': q.rate,
            'pool_disabled': q.disabled,
            'credit_balance': credits.balance_for(u),
            'last_used': r['last_used'].isoformat() if r['last_used'] else None,
        })
    out.sort(key=lambda x: x['pool_tokens'] + x['byok_tokens'], reverse=True)

    # Defaults so the admin UI can show "X using Y / Z monthly".
    from django.conf import settings as dj_settings
    cfg = AIPlatformSettings.load()
    return {
        'month_start': month_start.isoformat(),
        'defaults': {
            'daily_quota': cfg.daily_token_quota,
            'weekly_quota': cfg.weekly_token_quota,
            'monthly_quota': cfg.monthly_token_quota,
            'rate_limit_per_minute': cfg.rate_limit_per_minute,
        },
        'pool_configured': {
            'anthropic': bool(getattr(dj_settings, 'LLM_POOL_ANTHROPIC_API_KEY', '')),
            'openai': bool(getattr(dj_settings, 'LLM_POOL_OPENAI_API_KEY', '')),
            'local': bool(getattr(dj_settings, 'LLM_POOL_LOCAL_BASE_URL', '')),
        },
        'results': out,
    }


# ---- AI credits / subscriptions (lawyer-facing) ----------------------------

class AICreditPlanViewSet(viewsets.ReadOnlyModelViewSet):
    """Catalogue of active credit packs the lawyer can buy."""

    serializer_class = AICreditPlanSerializer
    permission_classes = [IsAuthenticated]
    queryset = AICreditPlan.objects.filter(is_active=True)


class AICreditAccountView(viewsets.ViewSet):
    """``GET /ai-credit-account/`` — the caller's resolved credit account
    (firm-if-any-else-lawyer) with balance, lifetime totals and recent
    ledger entries."""

    permission_classes = [IsAuthenticated]

    def list(self, request):
        account = credits.resolve_account(user=request.user)
        return Response(AICreditAccountSerializer(account).data)


def _notify_admins_of_credit_order(order, *, buyer) -> None:
    """Email + in-app notify every platform admin that a credit order needs
    verification. Never raises — a notification failure must not fail the
    purchase."""
    from django.contrib.auth import get_user_model
    from django.db.models import Q

    from core.models import NotificationKind
    from core.notify import notify

    try:
        User = get_user_model()
        admins = User.objects.filter(
            Q(is_superuser=True) | Q(is_staff=True) | Q(role='admin')
        ).filter(is_active=True).distinct()
        buyer_name = buyer.get_full_name() or buyer.email or str(buyer)
        title = f'AI credit order to verify — {order.token_credits:,} credits'
        body = (
            f'{buyer_name} ({order.owner_label}) submitted a proof of payment for '
            f'{order.amount} {order.currency}'
            f'{f" ({order.get_method_display() if order.method else order.method})" if order.method else ""}'
            f'{f", ref {order.reference}" if order.reference else ""}.\n\n'
            f'Verify it in the admin to grant the credits.'
        )
        link = f'/admin/workflows/aicreditorder/{order.pk}/change/'
        for admin in admins:
            notify(recipient=admin, kind=NotificationKind.PAYMENT, title=title, body=body, link=link)
    except Exception:
        pass


class AICreditOrderViewSet(viewsets.ModelViewSet):
    """The lawyer's own credit orders. ``POST`` (multipart) creates a pending
    order with a proof of payment; an admin verifies it to grant credits."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    http_method_names = ['get', 'post', 'head', 'options']
    queryset = AICreditOrder.objects.none()

    def get_serializer_class(self):
        return AICreditOrderCreateSerializer if self.action == 'create' else AICreditOrderSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return AICreditOrder.objects.none()
        # A lawyer sees orders billed to their account: their own plus their
        # firm's (the shared pool they draw from).
        user = self.request.user
        firm = credits.firm_for(user)
        qs = AICreditOrder.objects.filter(owner_user=user)
        if firm is not None:
            qs = AICreditOrder.objects.filter(owner_firm=firm) | qs
        return qs.select_related('plan').distinct()

    def create(self, request, *args, **kwargs):
        if not _is_lawyer(request.user):
            return Response(
                {'detail': 'Only practitioners can buy AI credits.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        plan = ser.validated_data['plan']

        # Route the order to the firm's account if the lawyer belongs to one,
        # else to their personal account — matching how credits are consumed.
        firm = credits.firm_for(request.user)
        owner = {'owner_firm': firm} if firm is not None else {'owner_user': request.user}

        order = AICreditOrder.objects.create(
            plan=plan,
            created_by=request.user,
            token_credits=plan.token_credits,
            amount=plan.price,
            currency=plan.currency,
            reference=ser.validated_data.get('reference', ''),
            method=ser.validated_data.get('method', ''),
            note=ser.validated_data.get('note', ''),
            proof_of_payment=ser.validated_data.get('proof_of_payment'),
            status=CreditOrderStatus.PENDING,
            **owner,
        )
        _notify_admins_of_credit_order(order, buyer=request.user)
        return Response(AICreditOrderSerializer(order).data, status=status.HTTP_201_CREATED)


# ---- Precedents + documents (editor) ---------------------------------------

class PrecedentTemplateViewSet(viewsets.ModelViewSet):
    """Catalogue of document precedents. Supports ``?workflow_template=<id>``
    and ``?category=<name>`` filters. Read for everyone; editing the agreed
    format (``PATCH``) is allowed so saved tweaks flow into all new documents."""

    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']
    queryset = PrecedentTemplate.objects.filter(is_active=True)

    def get_serializer_class(self):
        if self.action in ('retrieve', 'create', 'update', 'partial_update'):
            return PrecedentTemplateSerializer
        return PrecedentTemplateListSerializer

    def get_queryset(self):
        qs = PrecedentTemplate.objects.filter(is_active=True)
        wt = self.request.query_params.get('workflow_template')
        cat = self.request.query_params.get('category')
        if wt:
            qs = qs.filter(workflow_template_id=wt)
        if cat:
            qs = qs.filter(category__iexact=cat)
        return qs

    def perform_create(self, serializer):
        """New precedents need a unique slug; derive one from the name."""
        from django.utils.text import slugify

        base = (slugify(serializer.validated_data.get('name', '')) or 'template')[:100]
        slug = base
        i = 2
        while PrecedentTemplate.objects.filter(slug=slug).exists():
            slug = f'{base}-{i}'[:120]
            i += 1
        serializer.save(slug=slug, is_active=True)

    @action(detail=False, methods=['post'], url_path='generate')
    def generate(self, request):
        """Draft a brand-new precedent from a plain-language brief. Returns the
        draft (name/description/body/variables) for the lawyer to review and
        save — it is NOT persisted here. Metered like any other AI call."""
        if not _is_lawyer(request.user):
            return Response(
                {'detail': 'Template drafting is available to practitioners.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        instructions = (request.data.get('instructions') or '').strip()
        if not instructions:
            return Response(
                {'detail': 'Describe the template you need.'}, status=status.HTTP_400_BAD_REQUEST
            )
        config = _pick_provider_config()
        if config is None:
            return Response(
                {'detail': 'No AI provider has been configured by the administrator yet.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            hold = credits.begin_charge(request.user)
        except InsufficientCreditsError as c_err:
            return Response({'detail': str(c_err)}, status=status.HTTP_402_PAYMENT_REQUIRED)
        try:
            _enforce_pool_limits(request.user)
        except QuotaError as q_err:
            credits.release_charge(request.user, hold, 0, note='quota throttle — no run')
            return Response({'detail': str(q_err)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        try:
            completion = get_provider(config).complete(
                system=TEMPLATE_SYSTEM_PROMPT,
                user=instructions,
                model=config.default_model or None,
                user_id=_tenant_pseudo_id(request.user),
            )
        except ProviderError as e:
            credits.release_charge(request.user, hold, 0, note='provider error — refunded')
            _log_usage(request.user, config, error=str(e))
            return Response({'detail': str(e)}, status=status.HTTP_502_BAD_GATEWAY)

        usage = _log_usage(request.user, config, completion=completion)
        credits.release_charge(
            request.user, hold, completion.tokens_in + completion.tokens_out,
            usage_log=usage, note='Template drafting',
        )

        try:
            draft = parse_generated_template(completion.text)
        except ValueError:
            return Response(
                {'detail': 'The AI did not return a usable template. Try rephrasing your request.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(draft)


class WorkflowDocumentViewSet(viewsets.ModelViewSet):
    """A lawyer's editable documents. Create from a precedent (+field values),
    from a Claude stage result, or from raw title/body; edit; send to a matter."""

    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']
    queryset = WorkflowDocument.objects.none()

    def get_serializer_class(self):
        return WorkflowDocumentCreateSerializer if self.action == 'create' else WorkflowDocumentSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return WorkflowDocument.objects.none()
        qs = WorkflowDocument.objects.filter(owner=self.request.user)
        wf = self.request.query_params.get('workflow')
        if wf:
            qs = qs.filter(workflow_id=wf)
        return qs

    def create(self, request, *args, **kwargs):
        ser = WorkflowDocumentCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        v = ser.validated_data

        precedent = v.get('precedent')
        stage_result = v.get('stage_result')
        title = (v.get('title') or '').strip()
        body = v.get('body') or ''
        field_values = v.get('field_values') or {}
        workflow = v.get('workflow')

        if precedent is not None:
            body = render_precedent(precedent.body, field_values)
            title = title or precedent.name
        elif stage_result is not None:
            if stage_result.stage.workflow.owner_id != request.user.id:
                return Response(
                    {'detail': 'Not your stage result.'}, status=status.HTTP_403_FORBIDDEN
                )
            body = stage_result.output_text or ''
            title = title or stage_result.stage.title
            workflow = workflow or stage_result.stage.workflow

        # Only attach a workflow the caller owns.
        if workflow is not None and workflow.owner_id != request.user.id:
            workflow = None

        doc = WorkflowDocument.objects.create(
            owner=request.user,
            precedent=precedent,
            workflow=workflow,
            title=(title or 'Untitled document')[:300],
            body=body,
            field_values=field_values,
        )
        return Response(WorkflowDocumentSerializer(doc).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='send-to-matter')
    def send_to_matter(self, request, pk=None):
        """Create a matter draft document from this document and link it."""
        from django.db.models import Q

        from core.models import Document as MatterDocument
        from core.models import Matter

        doc = self.get_object()
        user = request.user
        # Mirror MatterViewSet visibility: own matters + firm-shared ones.
        scope = Q(client=user) | Q(lawyers=user)
        firm_id = getattr(getattr(user, 'lawyer_profile', None), 'firm_id', None)
        if firm_id:
            scope |= Q(lawyers__lawyer_profile__firm_id=firm_id)
        matter = Matter.objects.filter(scope, pk=request.data.get('matter')).distinct().first()
        if matter is None:
            return Response(
                {'detail': 'Matter not found or you are not a participant.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        mdoc = MatterDocument.objects.create(
            matter=matter, uploader=request.user, title=doc.title[:240],
            body=doc.body, kind='draft',
        )
        doc.sent_matter = matter
        doc.sent_document = mdoc
        doc.sent_at = timezone.now()
        doc.save(update_fields=['sent_matter', 'sent_document', 'sent_at', 'updated_at'])
        return Response(WorkflowDocumentSerializer(doc).data)



def _dispatch_contract_review(review_id, user_id, hold):
    """Kick off the (slow) contract-review LLM call without blocking the request.

    With a Celery broker, dispatch to the worker. Without one — the common local
    setup where ``CELERY_TASK_ALWAYS_EAGER`` is on — ``.delay()`` would run the
    whole LLM call synchronously inside the HTTP request and time it out, so we
    run it in a background thread instead. Either way the client polls the
    review's status until it is DONE/ERROR.
    """
    from django.conf import settings

    from .tasks import run_contract_review_task

    if not getattr(settings, 'CELERY_TASK_ALWAYS_EAGER', False):
        run_contract_review_task.delay(review_id, user_id, hold)
        return

    import threading

    def _run():
        try:
            run_contract_review_task(review_id, user_id, hold)
        finally:
            # Release this thread's DB connection so it isn't leaked.
            from django.db import connection
            connection.close()

    threading.Thread(target=_run, daemon=True).start()


class ContractReviewViewSet(viewsets.ModelViewSet):
    """Upload a contract; the AI analyses it into a risk-rated, sectioned report.
    The provider call runs in a Celery worker, or a background thread when no
    broker is configured (local dev)."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']
    queryset = ContractReview.objects.none()

    def get_serializer_class(self):
        return ContractReviewListSerializer if self.action == 'list' else ContractReviewSerializer

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return ContractReview.objects.none()
        return ContractReview.objects.filter(owner=self.request.user)

    def perform_update(self, serializer):
        """Keep the denormalised ``overall_risk``/``summary`` (used by the list
        view) in step with the lawyer's edits to ``result``."""
        review = serializer.save()
        result = review.result or {}
        fields = []
        if isinstance(result, dict):
            risk = (result.get('overall_risk') or '').lower()
            if risk in ('high', 'medium', 'low') and risk != review.overall_risk:
                review.overall_risk = risk
                fields.append('overall_risk')
            summary = str(result.get('summary') or '')
            if summary != review.summary:
                review.summary = summary
                fields.append('summary')
        if fields:
            review.save(update_fields=fields)

    @action(detail=True, methods=['post'], url_path='send-to-matter')
    def send_to_matter(self, request, pk=None):
        """Render the (curated) report to Markdown and drop it into a matter as
        a draft document. Mirrors WorkflowDocument.send_to_matter visibility."""
        from django.db.models import Q

        from core.models import Document as MatterDocument
        from core.models import Matter

        from .contracts import render_report_markdown

        review = self.get_object()
        if review.status != ContractReviewStatus.DONE:
            return Response({'detail': 'The review is not finished yet.'},
                            status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        scope = Q(client=user) | Q(lawyers=user)
        firm_id = getattr(getattr(user, 'lawyer_profile', None), 'firm_id', None)
        if firm_id:
            scope |= Q(lawyers__lawyer_profile__firm_id=firm_id)
        matter = Matter.objects.filter(scope, pk=request.data.get('matter')).distinct().first()
        if matter is None:
            return Response({'detail': 'Matter not found or you are not a participant.'},
                            status=status.HTTP_404_NOT_FOUND)

        title = (review.title or (review.result or {}).get('title') or 'Contract review')[:240]
        body = render_report_markdown(review.title, review.result or {})
        mdoc = MatterDocument.objects.create(
            matter=matter, uploader=user, title=title, body=body, kind='draft',
        )
        review.sent_matter = matter
        review.sent_document = mdoc
        review.sent_at = timezone.now()
        review.save(update_fields=['sent_matter', 'sent_document', 'sent_at', 'updated_at'])
        return Response(ContractReviewSerializer(review).data)

    def create(self, request, *args, **kwargs):
        if not _is_lawyer(request.user):
            return Response({'detail': 'Contract review is available to practitioners.'},
                            status=status.HTTP_403_FORBIDDEN)
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'detail': 'Attach a contract file (PDF, image or text).'},
                            status=status.HTTP_400_BAD_REQUEST)
        if upload.size > 15 * 1024 * 1024:
            return Response({'detail': 'File too large (max 15 MB).'},
                            status=status.HTTP_400_BAD_REQUEST)

        config = _pick_provider_config()
        if config is None:
            return Response({'detail': 'No AI provider has been configured by the administrator yet.'},
                            status=status.HTTP_400_BAD_REQUEST)

        review = ContractReview.objects.create(
            owner=request.user, title=(request.data.get('title') or '').strip()[:300],
            file=upload, status=ContractReviewStatus.PENDING,
        )
        try:
            hold = credits.begin_charge(request.user)
        except InsufficientCreditsError as c:
            review.delete()
            return Response({'detail': str(c)}, status=status.HTTP_402_PAYMENT_REQUIRED)
        try:
            _enforce_pool_limits(request.user)
        except QuotaError as q:
            credits.release_charge(request.user, hold, 0, note='quota throttle — no run')
            review.delete()
            return Response({'detail': str(q)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        review.status = ContractReviewStatus.PROCESSING
        review.save(update_fields=['status'])

        _dispatch_contract_review(review.id, request.user.id, hold)

        review.refresh_from_db()
        return Response(ContractReviewSerializer(review).data, status=status.HTTP_202_ACCEPTED)
