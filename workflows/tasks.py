"""Background execution of LLM stage runs.

The provider call can take tens of seconds, so it runs in a Celery worker
rather than blocking a web worker. Credits are reserved synchronously in the
request (see the view); this task reconciles the hold to the actual token count
and persists the result. In local dev (CELERY_TASK_ALWAYS_EAGER) it runs inline.
"""
import base64
import mimetypes

from celery import shared_task

from .models import ContractReview, ContractReviewStatus, StageResult, StageStatus, WorkflowStage


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


@shared_task
def run_contract_review_task(review_id, user_id, hold):
    """Send a contract to Claude, parse the structured risk analysis, store it,
    and reconcile the credit hold."""
    from django.contrib.auth import get_user_model

    from . import credits
    from .contracts import CONTRACT_SYSTEM_PROMPT, USER_INSTRUCTION, parse_review
    from .providers import ProviderError, get_provider
    from .views import _log_usage, _pick_provider_config, _tenant_pseudo_id

    User = get_user_model()
    try:
        review = ContractReview.objects.get(pk=review_id)
        user = User.objects.get(pk=user_id)
    except (ContractReview.DoesNotExist, User.DoesNotExist):
        return

    def fail(msg, tokens=0):
        credits.release_charge(user, hold, tokens, note='contract review — settled')
        review.status = ContractReviewStatus.ERROR
        review.error = msg[:2000]
        review.save(update_fields=['status', 'error', 'updated_at'])

    config = _pick_provider_config()
    if config is None:
        fail('No AI provider configured.')
        return

    # Build the content blocks from the uploaded file.
    try:
        with review.file.open('rb') as fh:
            raw = fh.read()
    except Exception as e:  # noqa: BLE001
        fail(f'Could not read the uploaded file: {e}')
        return

    media, _ = mimetypes.guess_type(review.file.name)
    name = review.file.name.rsplit('/', 1)[-1]
    if media == 'application/pdf' or name.lower().endswith('.pdf'):
        block = {'type': 'document', 'source': {
            'type': 'base64', 'media_type': 'application/pdf',
            'data': base64.b64encode(raw).decode('ascii')}}
    elif (media or '').startswith('image/'):
        block = {'type': 'image', 'source': {
            'type': 'base64', 'media_type': media,
            'data': base64.b64encode(raw).decode('ascii')}}
    else:
        text = raw.decode('utf-8', 'replace')[:200_000]
        block = {'type': 'text', 'text': f'CONTRACT:\n\n{text}'}

    messages = [{'role': 'user', 'content': [block, {'type': 'text', 'text': USER_INSTRUCTION}]}]

    try:
        completion = get_provider(config).complete(
            system=CONTRACT_SYSTEM_PROMPT, messages=messages,
            model=config.default_model or None, user_id=_tenant_pseudo_id(user),
            max_tokens=8192,  # contract analyses are long; avoid truncated JSON
        )
    except ProviderError as e:
        _log_usage(user, config, error=str(e))
        fail(str(e))
        return

    usage = _log_usage(user, config, completion=completion)
    credits.release_charge(user, hold, completion.tokens_in + completion.tokens_out,
                           usage_log=usage, note='Contract review')

    try:
        result = parse_review(completion.text)
    except ValueError as e:
        review.status = ContractReviewStatus.ERROR
        review.error = f'Could not parse the analysis: {e}'
        review.save(update_fields=['status', 'error', 'updated_at'])
        return

    review.result = result
    review.overall_risk = result.get('overall_risk', '')
    review.summary = result.get('summary', '')
    if not review.title:
        review.title = result.get('title') or name
    review.tokens_in = completion.tokens_in
    review.tokens_out = completion.tokens_out
    review.status = ContractReviewStatus.DONE
    review.save()
