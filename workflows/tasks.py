"""Background execution of LLM stage runs.

The provider call can take tens of seconds, so it runs in a Celery worker
rather than blocking a web worker. Credits are reserved synchronously in the
request (see the view); this task reconciles the hold to the actual token count
and persists the result. In local dev (CELERY_TASK_ALWAYS_EAGER) it runs inline.
"""
from celery import shared_task

from .models import StageResult, StageStatus, WorkflowStage


@shared_task
def run_stage_task(stage_id, user_id, system_prompt, user_prompt, model, hold):
    """Call the configured provider for a stage and persist a StageResult.
    Reconciles the credit hold on every outcome (success or failure)."""
    # Lazy imports to avoid a circular import with views at module load.
    from django.contrib.auth import get_user_model

    from . import credits
    from .providers import ProviderError, get_provider
    from .views import _log_usage, _pick_provider_config, _tenant_pseudo_id

    User = get_user_model()
    try:
        stage = WorkflowStage.objects.select_related('workflow').get(pk=stage_id)
        user = User.objects.get(pk=user_id)
    except (WorkflowStage.DoesNotExist, User.DoesNotExist):
        return

    config = _pick_provider_config(stage.provider)
    if config is None:
        credits.release_charge(user, hold, 0, note='no provider configured — refunded')
        _set_status(stage, StageStatus.PENDING)
        return

    adapter = get_provider(config)
    try:
        completion = adapter.complete(
            system=system_prompt, user=user_prompt, model=model or None,
            user_id=_tenant_pseudo_id(user),
        )
    except ProviderError as e:
        credits.release_charge(user, hold, 0, note='provider error — refunded')
        _log_usage(user, config, error=str(e))
        StageResult.objects.create(
            stage=stage, provider=config.provider, model=model or '',
            system_prompt=system_prompt, user_prompt=user_prompt, error=str(e),
        )
        _set_status(stage, StageStatus.PENDING)
        return

    usage = _log_usage(user, config, completion=completion)
    credits.release_charge(
        user, hold, completion.tokens_in + completion.tokens_out,
        usage_log=usage, note=f'Stage run: {stage.title}'[:240],
    )
    StageResult.objects.create(
        stage=stage, provider=config.provider, model=completion.model,
        system_prompt=system_prompt, user_prompt=user_prompt,
        output_text=completion.text, tokens_in=completion.tokens_in, tokens_out=completion.tokens_out,
    )
    _set_status(stage, StageStatus.AWAITING_APPROVAL)


def _set_status(stage, status):
    stage.status = status
    stage.save(update_fields=['status'])
