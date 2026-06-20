"""AI Workflows — stage-based legal-work pipeline.

A Workflow is an instance of a WorkflowTemplate. The template defines the
ordered stages; instantiating a workflow snapshots those stages into
WorkflowStage rows so per-matter overrides (chosen provider, model, prompt)
don't drift back into the shared template.
"""
from django.conf import settings
from django.core.validators import FileExtensionValidator
from django.db import models

from .fields import EncryptedTextField


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
    daily_token_quota = models.PositiveIntegerField(
        null=True, blank=True,
        help_text='Max tokens this user may spend per calendar day. Blank = platform default.',
    )
    weekly_token_quota = models.PositiveIntegerField(
        null=True, blank=True,
        help_text='Max tokens this user may spend per ISO week (Mon–Sun). Blank = platform default.',
    )
    monthly_token_quota = models.PositiveIntegerField(
        null=True, blank=True,
        help_text='Max tokens this user may spend per calendar month. Blank = platform default.',
    )
    rate_limit_per_minute = models.PositiveIntegerField(null=True, blank=True)
    is_pool_disabled = models.BooleanField(
        default=False,
        help_text='When True the user is blocked from the shared AI provider entirely.',
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
    #: Stored Fernet-encrypted at rest; the attribute reads back as plaintext.
    api_key = EncryptedTextField(blank=True, default='')
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


# ---------------------------------------------------------------------------
# Platform AI settings (singleton) — the per-lawyer usage throttles. Editable
# in Django admin; seeded from the LLM_POOL_* env settings on first load.
# ---------------------------------------------------------------------------

class AIPlatformSettings(models.Model):
    """Singleton holding the default AI usage throttles applied to every
    lawyer. Per-user overrides still live in :class:`LLMUserQuota`; these are
    the platform-wide fallbacks. Token quotas stack (day/week/month) — set any
    to 0 to disable that window."""

    daily_token_quota = models.PositiveIntegerField(default=20_000)
    weekly_token_quota = models.PositiveIntegerField(default=60_000)
    monthly_token_quota = models.PositiveIntegerField(default=200_000)
    rate_limit_per_minute = models.PositiveIntegerField(default=20)
    free_tier_credits = models.PositiveIntegerField(
        default=10_000,
        help_text='AI credits granted once, for free, to every new lawyer/firm account '
                  'before they buy a plan. Set to 0 to disable the free tier.',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'AI platform settings'
        verbose_name_plural = 'AI platform settings'

    def __str__(self):
        return 'AI platform settings'

    def save(self, *args, **kwargs):
        self.pk = 1  # enforce a single row
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        """Return the singleton, creating it (seeded from env settings) on
        first access so existing LLM_POOL_* values carry over."""
        from django.conf import settings as dj_settings

        obj, _ = cls.objects.get_or_create(
            pk=1,
            defaults={
                'daily_token_quota': getattr(dj_settings, 'LLM_POOL_DAILY_TOKEN_QUOTA', 20_000),
                'weekly_token_quota': getattr(dj_settings, 'LLM_POOL_WEEKLY_TOKEN_QUOTA', 60_000),
                'monthly_token_quota': getattr(dj_settings, 'LLM_POOL_MONTHLY_TOKEN_QUOTA', 200_000),
                'rate_limit_per_minute': getattr(dj_settings, 'LLM_POOL_RATE_LIMIT_PER_MINUTE', 20),
            },
        )
        return obj


# ---------------------------------------------------------------------------
# AI credits — prepaid token balance unlocked via proof-of-payment.
#
# A lawyer's AI runs are charged to a single AICreditAccount: their firm's
# account if they belong to a firm, otherwise their own. An admin defines
# AICreditPlans (token packs / subscriptions); a lawyer or firm submits an
# AICreditOrder with a proof of payment; once an admin verifies it, the plan's
# token_credits are granted to the account via an append-only ledger.
# ---------------------------------------------------------------------------

class CreditPlanPeriod(models.TextChoices):
    ONE_TIME = 'one_time', 'One-time top-up'
    MONTHLY = 'monthly', 'Monthly'
    QUARTERLY = 'quarterly', 'Quarterly'
    ANNUAL = 'annual', 'Annual'


class AICreditPlan(models.Model):
    """A purchasable pack/subscription that grants a number of AI token
    credits when an order against it is verified."""

    name = models.CharField(max_length=120)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=8, default='USD')
    token_credits = models.PositiveBigIntegerField(
        help_text='AI tokens granted to the account when an order for this plan is verified.'
    )
    period = models.CharField(
        max_length=16, choices=CreditPlanPeriod.choices, default=CreditPlanPeriod.ONE_TIME
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['price']

    def __str__(self):
        return f'{self.name} · {self.token_credits:,} credits · {self.price} {self.currency}'


class AICreditAccount(models.Model):
    """Prepaid AI token balance for a firm or an individual lawyer. Balance is
    a cache kept in lock-step with the append-only transaction ledger; never
    mutate it directly — go through :mod:`workflows.credits`."""

    owner_user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.CASCADE, related_name='ai_credit_account',
    )
    owner_firm = models.OneToOneField(
        'core.Firm', null=True, blank=True,
        on_delete=models.CASCADE, related_name='ai_credit_account',
    )
    balance = models.BigIntegerField(
        default=0, help_text='Current AI token balance. May dip slightly negative if a call overshoots.'
    )
    free_tier_granted = models.BooleanField(
        default=False, help_text='Whether the one-time free-tier credits have been granted to this account.'
    )
    lifetime_granted = models.PositiveBigIntegerField(default=0)
    lifetime_spent = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                name='ai_credit_account_exactly_one_owner',
                check=(
                    models.Q(owner_user__isnull=False, owner_firm__isnull=True)
                    | models.Q(owner_user__isnull=True, owner_firm__isnull=False)
                ),
            )
        ]

    @property
    def owner_label(self) -> str:
        if self.owner_firm_id:
            return f'Firm: {self.owner_firm}'
        if self.owner_user_id:
            return f'Lawyer: {self.owner_user}'
        return 'Unassigned'

    def __str__(self):
        return f'{self.owner_label} · {self.balance:,} credits'


class CreditOrderStatus(models.TextChoices):
    PENDING = 'pending', 'Pending review'
    VERIFIED = 'verified', 'Verified'
    REJECTED = 'rejected', 'Rejected'
    CANCELLED = 'cancelled', 'Cancelled'


def ai_credit_pop_path(instance, filename):
    who = instance.owner_firm_id and f'firm_{instance.owner_firm_id}' or f'user_{instance.owner_user_id}'
    return f'ai_credit_pops/{who}/{filename}'


class AICreditOrder(models.Model):
    """A request to buy AI credits, evidenced by a proof of payment. An admin
    verifies it in Django admin; verification grants ``token_credits`` to the
    resolved account. Either ``owner_firm`` or ``owner_user`` is set."""

    owner_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.CASCADE, related_name='ai_credit_orders',
    )
    owner_firm = models.ForeignKey(
        'core.Firm', null=True, blank=True,
        on_delete=models.CASCADE, related_name='ai_credit_orders',
    )
    plan = models.ForeignKey(
        AICreditPlan, null=True, blank=True, on_delete=models.SET_NULL, related_name='orders'
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='submitted_ai_credit_orders',
        help_text='The lawyer who submitted this order (notified on verify/reject).',
    )
    token_credits = models.PositiveBigIntegerField(
        help_text='Credits granted on verification. Defaults from the plan; override for ad-hoc grants.'
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=8, default='USD')
    reference = models.CharField(max_length=256, blank=True, help_text='Bank / mobile-money reference.')
    method = models.CharField(max_length=32, blank=True, help_text='ecocash / innbucks / bank / cash / other.')

    proof_of_payment = models.FileField(
        upload_to=ai_credit_pop_path, blank=True, null=True,
        validators=[FileExtensionValidator(['pdf', 'png', 'jpg', 'jpeg', 'webp'])],
        help_text='Uploaded proof of payment (PDF or image).',
    )
    note = models.TextField(blank=True, help_text='Payer-supplied note.')

    status = models.CharField(
        max_length=16, choices=CreditOrderStatus.choices, default=CreditOrderStatus.PENDING
    )
    # Subscription term, if relevant (informational; metering is credit-based).
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)

    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='reviewed_ai_credit_orders',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['status', '-created_at'])]
        constraints = [
            models.CheckConstraint(
                name='ai_credit_order_exactly_one_owner',
                check=(
                    models.Q(owner_user__isnull=False, owner_firm__isnull=True)
                    | models.Q(owner_user__isnull=True, owner_firm__isnull=False)
                ),
            )
        ]

    @property
    def owner_label(self) -> str:
        if self.owner_firm_id:
            return f'Firm: {self.owner_firm}'
        if self.owner_user_id:
            return f'Lawyer: {self.owner_user}'
        return 'Unassigned'

    def __str__(self):
        return f'Order({self.token_credits:,} credits · {self.owner_label} · {self.get_status_display()})'


class CreditTxnKind(models.TextChoices):
    GRANT = 'grant', 'Grant (purchase verified)'
    HOLD = 'hold', 'Hold (reservation for an AI run)'
    DEBIT = 'debit', 'Debit (AI usage)'
    REFUND = 'refund', 'Refund'
    ADJUSTMENT = 'adjustment', 'Manual adjustment'
    EXPIRY = 'expiry', 'Expiry'


class AICreditTransaction(models.Model):
    """Append-only ledger row. ``amount`` is signed tokens (positive grant,
    negative debit); ``balance_after`` snapshots the account balance."""

    account = models.ForeignKey(
        AICreditAccount, on_delete=models.CASCADE, related_name='transactions'
    )
    kind = models.CharField(max_length=16, choices=CreditTxnKind.choices)
    amount = models.BigIntegerField(help_text='Signed token delta: +grant, -debit.')
    balance_after = models.BigIntegerField()
    order = models.ForeignKey(
        AICreditOrder, null=True, blank=True, on_delete=models.SET_NULL, related_name='transactions'
    )
    usage_log = models.ForeignKey(
        'workflows.LLMUsageLog', null=True, blank=True, on_delete=models.SET_NULL, related_name='credit_transactions'
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='ai_credit_actions',
    )
    note = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['account', '-created_at'])]

    def __str__(self):
        return f'{self.get_kind_display()} {self.amount:+,} → {self.balance_after:,}'


# ---------------------------------------------------------------------------
# Precedents (document templates) + generated documents
#
# A PrecedentTemplate is a reusable legal document skeleton in Markdown with
# ``{{placeholders}}``. A lawyer fills a few fields, we prepopulate the body,
# and they get an editable WorkflowDocument they can edit, download, or send
# to a matter. Documents can also be created from a Claude stage output.
# ---------------------------------------------------------------------------

class PrecedentTemplate(models.Model):
    """A reusable Markdown document precedent with fillable variables."""

    slug = models.SlugField(unique=True, max_length=120)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    matter_type = models.CharField(max_length=120, blank=True)
    category = models.CharField(
        max_length=80, blank=True,
        help_text='e.g. Affidavits, Pleadings, Agreements, Letters.',
    )
    workflow_template = models.ForeignKey(
        WorkflowTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name='precedents'
    )
    #: Markdown body with ``{{key}}`` placeholders.
    body = models.TextField()
    #: Ordered fields to collect, each: {
    #:   "key": "case_number", "label": "Case number",
    #:   "help": "", "required": true, "type": "text"|"textarea"|"date"
    #: }
    variables = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['category', 'name']

    def __str__(self):
        return self.name


class DocumentStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    FINAL = 'final', 'Final'


class WorkflowDocument(models.Model):
    """An editable Markdown document produced by a lawyer — prepopulated from a
    precedent, copied from a Claude stage output, or written from scratch."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='workflow_documents'
    )
    workflow = models.ForeignKey(
        Workflow, null=True, blank=True, on_delete=models.SET_NULL, related_name='documents'
    )
    precedent = models.ForeignKey(
        PrecedentTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name='documents'
    )
    title = models.CharField(max_length=300)
    body = models.TextField(blank=True)
    #: The values used to prepopulate the body from the precedent.
    field_values = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=DocumentStatus.choices, default=DocumentStatus.DRAFT)
    #: Set once this document has been pushed into a matter room.
    sent_matter = models.ForeignKey(
        'core.Matter', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    sent_document = models.ForeignKey(
        'core.Document', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.title


# ---------------------------------------------------------------------------
# Contract review — upload a contract, Claude analyses it into risk-rated
# sections (a "heat map") with per-clause issues and recommendations.
# ---------------------------------------------------------------------------

class ContractReviewStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    PROCESSING = 'processing', 'Processing'
    DONE = 'done', 'Done'
    ERROR = 'error', 'Error'


def contract_path(instance, filename):
    return f'contract_reviews/user_{instance.owner_id}/{filename}'


class ContractReview(models.Model):
    """An AI risk review of an uploaded contract."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='contract_reviews'
    )
    title = models.CharField(max_length=300, blank=True)
    file = models.FileField(
        upload_to=contract_path, null=True, blank=True,
        validators=[FileExtensionValidator(['pdf', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'])],
    )
    status = models.CharField(
        max_length=16, choices=ContractReviewStatus.choices, default=ContractReviewStatus.PENDING
    )
    overall_risk = models.CharField(max_length=10, blank=True)  # high | medium | low
    summary = models.TextField(blank=True)
    #: Full structured analysis: {title, overall_risk, summary, parties[], sections[]}.
    result = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    tokens_in = models.PositiveIntegerField(default=0)
    tokens_out = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title or f'Contract review {self.pk}'
