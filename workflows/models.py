"""AI Workflows — stage-based legal-work pipeline.

A Workflow is an instance of a WorkflowTemplate. The template defines the
ordered stages; instantiating a workflow snapshots those stages into
WorkflowStage rows so per-matter overrides (chosen provider, model, prompt)
don't drift back into the shared template.
"""
from django.conf import settings
from django.db import models


class LLMProvider(models.TextChoices):
    """Concrete provider implementations registered in ``providers.py``."""

    ANTHROPIC = 'anthropic', 'Anthropic (Claude)'
    OPENAI = 'openai', 'OpenAI (ChatGPT)'
    LOCAL = 'local', 'Local / self-hosted (Ollama-compatible)'


class StageStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    IN_PROGRESS = 'in_progress', 'In progress'
    AWAITING_APPROVAL = 'awaiting_approval', 'Awaiting approval'
    APPROVED = 'approved', 'Approved'


class WorkflowStatus(models.TextChoices):
    ACTIVE = 'active', 'Active'
    COMPLETED = 'completed', 'Completed'
    ARCHIVED = 'archived', 'Archived'


class WorkflowTemplate(models.Model):
    """A reusable matter-type template (e.g. Spoliation Application)."""

    slug = models.SlugField(unique=True, max_length=80)
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    matter_type = models.CharField(max_length=80, blank=True)
    #: Ordered list of stage definitions. Each item: {
    #:   "slug": "intake", "title": "Intake",
    #:   "purpose": "Capture facts into a structured matrix",
    #:   "retrieval_scope": "none",
    #:   "default_provider": "anthropic",
    #:   "default_model": "claude-opus-4-7",
    #:   "prompt_template": "...",
    #: }
    stages = models.JSONField(default=list)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Workflow(models.Model):
    """An instance of a WorkflowTemplate, owned by a lawyer, optionally
    attached to a matter."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='workflows'
    )
    template = models.ForeignKey(
        WorkflowTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name='workflows'
    )
    matter = models.ForeignKey(
        'core.Matter', null=True, blank=True, on_delete=models.SET_NULL, related_name='workflows'
    )
    name = models.CharField(max_length=200)
    status = models.CharField(
        max_length=16, choices=WorkflowStatus.choices, default=WorkflowStatus.ACTIVE
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.owner.email})'


class WorkflowStage(models.Model):
    """One stage in a workflow. Snapshotted from the template at creation
    so subsequent template edits don't perturb running workflows."""

    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name='stages')
    slug = models.SlugField(max_length=64)
    title = models.CharField(max_length=160)
    purpose = models.TextField(blank=True)
    retrieval_scope = models.CharField(max_length=64, blank=True)
    prompt_template = models.TextField(blank=True)
    prompt_template_version = models.PositiveIntegerField(default=1)
    #: The provider configured for *this* stage (overrides template default).
    provider = models.CharField(
        max_length=16, choices=LLMProvider.choices, default=LLMProvider.ANTHROPIC
    )
    model = models.CharField(max_length=80, blank=True)
    order = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=24, choices=StageStatus.choices, default=StageStatus.PENDING
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True, on_delete=models.SET_NULL, related_name='approved_stages',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']
        unique_together = ('workflow', 'slug')

    def __str__(self):
        return f'{self.workflow.name} · {self.title}'


class StageResult(models.Model):
    """One LLM completion for a stage. A stage may have several (re-runs,
    dual-model comparisons). The latest approved result is the canonical
    output for downstream stages."""

    stage = models.ForeignKey(WorkflowStage, on_delete=models.CASCADE, related_name='results')
    provider = models.CharField(max_length=16, choices=LLMProvider.choices)
    model = models.CharField(max_length=80, blank=True)
    system_prompt = models.TextField(blank=True)
    user_prompt = models.TextField(blank=True)
    output_text = models.TextField(blank=True)
    #: IDs of retrieved RAG chunks fed to the model (when RAG is wired).
    retrieval_chunk_ids = models.JSONField(default=list, blank=True)
    tokens_in = models.PositiveIntegerField(default=0)
    tokens_out = models.PositiveIntegerField(default=0)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.stage.title} via {self.provider}'


class LLMUsageLog(models.Model):
    """One row per LLM call. Every workflow stage run + co-researcher ask
    writes here so the platform can attribute spend, hold per-tenant
    quotas, and surface usage to admins."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='llm_usage_logs'
    )
    provider = models.CharField(max_length=16, choices=LLMProvider.choices)
    model = models.CharField(max_length=80, blank=True)
    tokens_in = models.PositiveIntegerField(default=0)
    tokens_out = models.PositiveIntegerField(default=0)
    pool = models.BooleanField(default=False, help_text='True when served by the platform pool key.')
    error = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['owner', '-created_at']),
            models.Index(fields=['pool', '-created_at']),
        ]


class LLMUserQuota(models.Model):
    """Per-user override of the platform's default pool quota. Falls back
    to ``settings.LLM_POOL_*`` when no row exists for a given user."""

    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='llm_quota'
    )
    monthly_token_quota = models.PositiveIntegerField(null=True, blank=True)
    rate_limit_per_minute = models.PositiveIntegerField(null=True, blank=True)
    is_pool_disabled = models.BooleanField(
        default=False,
        help_text='When True the user must BYOK; pool-key fallback is denied.',
    )
    updated_at = models.DateTimeField(auto_now=True)


class LLMProviderConfig(models.Model):
    """A lawyer's saved provider configuration. Multiple per user — they may
    have separate Claude and OpenAI configurations; ``is_default`` marks
    which one is picked for stages that don't override per-stage.

    NOTE: API keys are stored plaintext in this MVP. For production, wrap
    with ``cryptography.fernet`` keyed off ``settings.SECRET_KEY``.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='llm_provider_configs'
    )
    provider = models.CharField(max_length=16, choices=LLMProvider.choices)
    label = models.CharField(max_length=80, blank=True)
    api_key = models.CharField(max_length=512, blank=True)
    #: Used by LocalProvider (e.g. http://localhost:11434 for Ollama).
    base_url = models.URLField(blank=True)
    default_model = models.CharField(max_length=80, blank=True)
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['provider', 'label']

    def __str__(self):
        return f'{self.get_provider_display()} · {self.label or self.default_model}'
