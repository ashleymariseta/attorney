from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
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
from .providers import ProviderError, get_provider, list_supported, pool_config
from .serializers import (
    LLMProviderConfigSerializer,
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


def _user_quota(user) -> tuple[int, int, bool]:
    """Return ``(monthly_tokens, rate_per_minute, pool_disabled)`` for the
    user, falling back to platform settings when no override row exists."""
    from django.conf import settings as dj_settings

    row = LLMUserQuota.objects.filter(owner=user).first()
    monthly = getattr(dj_settings, 'LLM_POOL_MONTHLY_TOKEN_QUOTA', 200_000)
    rate = getattr(dj_settings, 'LLM_POOL_RATE_LIMIT_PER_MINUTE', 20)
    disabled = False
    if row:
        if row.monthly_token_quota is not None:
            monthly = row.monthly_token_quota
        if row.rate_limit_per_minute is not None:
            rate = row.rate_limit_per_minute
        disabled = row.is_pool_disabled
    return monthly, rate, disabled


def _enforce_pool_limits(user) -> None:
    """Check rate + monthly quota *before* a pool-key call. Raises
    :class:`QuotaError` with a clear message on breach.

    BYOK calls bypass this entirely — that's the lawyer's own bill."""
    from datetime import timedelta
    from django.db.models import Sum
    from django.utils import timezone as tz

    monthly, rate, disabled = _user_quota(user)
    if disabled:
        raise QuotaError('Your account is set to BYOK only — add an LLM provider in AI Workflows → Providers.')

    minute_ago = tz.now() - timedelta(minutes=1)
    recent = LLMUsageLog.objects.filter(owner=user, pool=True, created_at__gte=minute_ago).count()
    if recent >= rate:
        raise QuotaError(f'Rate limit reached ({rate}/min on the platform pool key). Try again in a moment.')

    month_start = tz.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    spent = LLMUsageLog.objects.filter(
        owner=user, pool=True, created_at__gte=month_start
    ).aggregate(total=Sum('tokens_in') + Sum('tokens_out'))['total'] or 0
    if spent >= monthly:
        raise QuotaError(
            f'Monthly token quota exhausted ({monthly:,}). Add your own provider key to keep going.'
        )


def _log_usage(user, config, completion=None, error: str = '') -> None:
    """Persist one LLMUsageLog row. Called after every provider call (pool
    or BYOK) so the admin dashboard shows full attribution."""
    is_pool = getattr(config, 'is_pool', False)
    LLMUsageLog.objects.create(
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
        provider_id = request.data.get('provider_config_id')

        config = _pick_provider_config(request.user, stage.provider, provider_id)
        if config is None:
            return Response(
                {'detail': 'No matching provider configured. Add one in Providers settings.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Pool-key calls go through rate-limit + monthly quota guards. BYOK
        # calls run on the lawyer's own bill so we let them through.
        if getattr(config, 'is_pool', False):
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

        _log_usage(request.user, config, completion=completion)
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


def _pick_provider_config(user, provider, explicit_id):
    """Find the provider config to use for a given stage call.

    Priority: explicit ``provider_config_id`` from the request → user's
    default config for the stage's provider → first config for that
    provider → platform pool key (synthesized from settings) → ``None``.

    The returned object always carries ``provider``, ``api_key``,
    ``base_url``, ``default_model`` and an ``is_pool`` flag.
    """
    qs = LLMProviderConfig.objects.filter(owner=user)
    if explicit_id:
        return qs.filter(id=explicit_id).first()
    user_cfg = (
        qs.filter(provider=provider, is_default=True).first()
        or qs.filter(provider=provider).first()
    )
    if user_cfg is not None:
        return user_cfg
    return pool_config(provider)


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
        monthly, rate, disabled = _user_quota(u)
        out.append({
            **r,
            'email': u.email,
            'full_name': u.get_full_name() or u.email,
            'role': getattr(u, 'role', ''),
            'monthly_quota': monthly,
            'rate_limit_per_minute': rate,
            'pool_disabled': disabled,
            'last_used': r['last_used'].isoformat() if r['last_used'] else None,
        })
    out.sort(key=lambda x: x['pool_tokens'] + x['byok_tokens'], reverse=True)

    # Defaults so the admin UI can show "X using Y / Z monthly".
    from django.conf import settings as dj_settings
    return {
        'month_start': month_start.isoformat(),
        'defaults': {
            'monthly_quota': getattr(dj_settings, 'LLM_POOL_MONTHLY_TOKEN_QUOTA', 200_000),
            'rate_limit_per_minute': getattr(dj_settings, 'LLM_POOL_RATE_LIMIT_PER_MINUTE', 20),
        },
        'pool_configured': {
            'anthropic': bool(getattr(dj_settings, 'LLM_POOL_ANTHROPIC_API_KEY', '')),
            'openai': bool(getattr(dj_settings, 'LLM_POOL_OPENAI_API_KEY', '')),
            'local': bool(getattr(dj_settings, 'LLM_POOL_LOCAL_BASE_URL', '')),
        },
        'results': out,
    }


class LLMProviderConfigViewSet(viewsets.ModelViewSet):
    serializer_class = LLMProviderConfigSerializer
    permission_classes = [IsAuthenticated]
    queryset = LLMProviderConfig.objects.none()

    def get_queryset(self):
        if getattr(self, 'swagger_fake_view', False):
            return LLMProviderConfig.objects.none()
        return LLMProviderConfig.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        cfg = serializer.save(owner=self.request.user)
        if cfg.is_default:
            # Only one default per provider per user.
            LLMProviderConfig.objects.filter(
                owner=self.request.user, provider=cfg.provider
            ).exclude(id=cfg.id).update(is_default=False)

    def perform_update(self, serializer):
        cfg = serializer.save()
        if cfg.is_default:
            LLMProviderConfig.objects.filter(
                owner=self.request.user, provider=cfg.provider
            ).exclude(id=cfg.id).update(is_default=False)

    @action(detail=False, methods=['get'])
    def supported(self, request):
        """Static description of every adapter — drives the settings UI."""
        return Response(list_supported())
