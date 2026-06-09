from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    LLMProviderConfig,
    StageResult,
    StageStatus,
    Workflow,
    WorkflowStage,
    WorkflowTemplate,
)
from .providers import ProviderError, get_provider, list_supported
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

        adapter = get_provider(config)
        model = request.data.get('model') or stage.model or config.default_model
        try:
            completion = adapter.complete(system=system_prompt, user=user_prompt, model=model)
        except ProviderError as e:
            result = StageResult.objects.create(
                stage=stage, provider=config.provider, model=model or '',
                system_prompt=system_prompt, user_prompt=user_prompt,
                error=str(e),
            )
            return Response(
                {'detail': str(e), 'result': StageResultSerializer(result).data},
                status=status.HTTP_502_BAD_GATEWAY,
            )

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
    provider → ``None``.
    """
    qs = LLMProviderConfig.objects.filter(owner=user)
    if explicit_id:
        return qs.filter(id=explicit_id).first()
    return (
        qs.filter(provider=provider, is_default=True).first()
        or qs.filter(provider=provider).first()
    )


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
