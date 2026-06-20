from collections import namedtuple

from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import credits
from .credits import InsufficientCreditsError
from .models import (
    AIPlatformSettings,
    LLMProvider,
    LLMProviderConfig,
    LLMUsageLog,
    LLMUserQuota,
    StageResult,
    StageStatus,
    Workflow,
    WorkflowStage,
    WorkflowTemplate,
)
from .providers import ProviderError, get_provider, pool_config
from .serializers import (
    StageResultSerializer,
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
    http_method_names = ['get', 'patch', 'head', 'options']

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

        # Credits are the hard gate (must have a positive balance to start);
        # the per-minute rate and day/week/month token quotas throttle on top.
        try:
            credits.assert_can_spend(request.user)
        except InsufficientCreditsError as c:
            return Response({'detail': str(c)}, status=status.HTTP_402_PAYMENT_REQUIRED)
        try:
            _enforce_pool_limits(request.user)
        except QuotaError as q:
            return Response({'detail': str(q)}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        adapter = get_provider(config)
        model = request.data.get('model') or stage.model or config.default_model
        try:
            completion = adapter.complete(
                system=system_prompt,
                user=user_prompt,
                model=model,
                user_id=_tenant_pseudo_id(request.user),
            )
        except ProviderError as e:
            _log_usage(request.user, config, error=str(e))
            result = StageResult.objects.create(
                stage=stage, provider=config.provider, model=model or '',
                system_prompt=system_prompt, user_prompt=user_prompt,
                error=str(e),
            )
            return Response(
                {'detail': str(e), 'result': StageResultSerializer(result).data},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        usage = _log_usage(request.user, config, completion=completion)
        credits.charge_usage(request.user, completion, usage_log=usage, note=f'Stage run: {stage.title}'[:240])
        result = StageResult.objects.create(
            stage=stage,
            provider=config.provider,
            model=completion.model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            output_text=completion.text,
            tokens_in=completion.tokens_in,
            tokens_out=completion.tokens_out,
        )
        stage.status = StageStatus.AWAITING_APPROVAL
        stage.save(update_fields=['status'])
        return Response(StageResultSerializer(result).data, status=status.HTTP_201_CREATED)


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


