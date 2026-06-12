"""Pluggable LLM provider abstraction.

Mirrors the pattern used in ``payments/providers.py``. The rest of the
codebase only depends on :class:`BaseLLMProvider` — adding Gemini, AWS
Bedrock, or a different self-hosted server later is a new subclass, not a
refactor.

The concrete providers use ``urllib`` (stdlib) for HTTP so we don't pull in
``httpx`` or ``requests``. Each ``complete()`` call is synchronous; the
caller is expected to dispatch to a background worker if a single call may
exceed a request timeout (Celery is already wired in this project).
"""
from __future__ import annotations

import abc
import json
from dataclasses import dataclass, field
from typing import Optional
from urllib import error as urlerror
from urllib import request as urlrequest

from .models import LLMProvider, LLMProviderConfig


@dataclass
class Completion:
    """Provider-agnostic result returned by every adapter."""

    text: str
    provider: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    raw: dict = field(default_factory=dict)


class ProviderError(Exception):
    """Raised when an upstream LLM call fails. Callers should surface the
    message to the practitioner (it's their key/quota/network)."""


class BaseLLMProvider(abc.ABC):
    """Contract every LLM adapter must satisfy."""

    name: str = 'base'
    default_model: str = ''

    def __init__(self, config: LLMProviderConfig):
        self.config = config

    @abc.abstractmethod
    def complete(
        self,
        *,
        system: str,
        user: str,
        model: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Completion:
        """Single-turn completion. Returns a populated :class:`Completion`
        or raises :class:`ProviderError`.

        ``user_id`` is a stable per-tenant identifier (e.g. a hash of the
        lawyer's user id) attached to provider-side telemetry so abuse can
        be attributed without sending PII upstream.
        """

    # --- helpers ---------------------------------------------------------
    @staticmethod
    def _post_json(url: str, headers: dict, payload: dict, timeout: float = 60.0) -> dict:
        body = json.dumps(payload).encode('utf-8')
        req = urlrequest.Request(url, data=body, method='POST')
        for k, v in headers.items():
            req.add_header(k, v)
        req.add_header('Content-Type', 'application/json')
        try:
            with urlrequest.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urlerror.HTTPError as e:
            detail = e.read().decode('utf-8', errors='replace') if e.fp else str(e)
            raise ProviderError(f'{e.code}: {detail[:500]}')
        except urlerror.URLError as e:
            raise ProviderError(f'Could not reach provider: {e.reason}')


class ClaudeProvider(BaseLLMProvider):
    """Anthropic Messages API. Docs: https://docs.anthropic.com/."""

    name = 'anthropic'
    default_model = 'claude-opus-4-7'

    def complete(self, *, system, user, model=None, user_id=None):
        if not self.config.api_key:
            raise ProviderError('No Anthropic API key configured.')
        model = model or self.config.default_model or self.default_model
        headers = {
            'x-api-key': self.config.api_key,
            'anthropic-version': '2023-06-01',
        }
        payload = {
            'model': model,
            'max_tokens': 4096,
            'system': system,
            'messages': [{'role': 'user', 'content': user}],
        }
        if user_id:
            payload['metadata'] = {'user_id': user_id}
        data = self._post_json('https://api.anthropic.com/v1/messages', headers, payload)
        text = ''
        for block in data.get('content', []) or []:
            if block.get('type') == 'text':
                text += block.get('text', '')
        usage = data.get('usage', {}) or {}
        return Completion(
            text=text,
            provider=self.name,
            model=data.get('model', model),
            tokens_in=int(usage.get('input_tokens', 0) or 0),
            tokens_out=int(usage.get('output_tokens', 0) or 0),
            raw=data,
        )


class OpenAIProvider(BaseLLMProvider):
    """OpenAI Chat Completions. Docs: https://platform.openai.com/docs/."""

    name = 'openai'
    default_model = 'gpt-4o'

    def complete(self, *, system, user, model=None, user_id=None):
        if not self.config.api_key:
            raise ProviderError('No OpenAI API key configured.')
        model = model or self.config.default_model or self.default_model
        headers = {'Authorization': f'Bearer {self.config.api_key}'}
        payload = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': user},
            ],
            'temperature': 0.2,
        }
        if user_id:
            payload['user'] = user_id
        base = (self.config.base_url or 'https://api.openai.com').rstrip('/')
        data = self._post_json(f'{base}/v1/chat/completions', headers, payload)
        choices = data.get('choices') or []
        text = choices[0]['message']['content'] if choices else ''
        usage = data.get('usage', {}) or {}
        return Completion(
            text=text,
            provider=self.name,
            model=data.get('model', model),
            tokens_in=int(usage.get('prompt_tokens', 0) or 0),
            tokens_out=int(usage.get('completion_tokens', 0) or 0),
            raw=data,
        )


class LocalProvider(BaseLLMProvider):
    """Self-hosted endpoint (Ollama or any OpenAI-compatible server).

    Configuration:
      * ``base_url`` — e.g. ``http://localhost:11434`` for Ollama, or your
        vLLM/llama.cpp host that speaks the OpenAI chat-completions schema.
      * ``api_key`` — optional; if set we add ``Authorization: Bearer …``.

    We try Ollama's native ``/api/chat`` first, then fall back to the
    OpenAI-compatible path. This keeps the UI single-button regardless of
    which self-hosted stack the lawyer is running.
    """

    name = 'local'
    default_model = 'llama3.1'

    def complete(self, *, system, user, model=None, user_id=None):
        # user_id intentionally unused — self-hosted endpoints typically
        # don't need provider-side attribution and many ignore extra fields.
        del user_id
        if not self.config.base_url:
            raise ProviderError('No base URL configured for the local provider.')
        model = model or self.config.default_model or self.default_model
        headers = {}
        if self.config.api_key:
            headers['Authorization'] = f'Bearer {self.config.api_key}'
        base = self.config.base_url.rstrip('/')

        # Ollama native API.
        try:
            payload = {
                'model': model,
                'stream': False,
                'messages': [
                    {'role': 'system', 'content': system},
                    {'role': 'user', 'content': user},
                ],
            }
            data = self._post_json(f'{base}/api/chat', headers, payload)
            if 'message' in data:
                return Completion(
                    text=(data['message'] or {}).get('content', ''),
                    provider=self.name,
                    model=data.get('model', model),
                    tokens_in=int(data.get('prompt_eval_count', 0) or 0),
                    tokens_out=int(data.get('eval_count', 0) or 0),
                    raw=data,
                )
        except ProviderError:
            pass  # Try OpenAI-compatible path next.

        # OpenAI-compatible fallback.
        payload = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': user},
            ],
            'temperature': 0.2,
        }
        data = self._post_json(f'{base}/v1/chat/completions', headers, payload)
        choices = data.get('choices') or []
        text = choices[0]['message']['content'] if choices else ''
        usage = data.get('usage', {}) or {}
        return Completion(
            text=text,
            provider=self.name,
            model=data.get('model', model),
            tokens_in=int(usage.get('prompt_tokens', 0) or 0),
            tokens_out=int(usage.get('completion_tokens', 0) or 0),
            raw=data,
        )


_REGISTRY = {
    LLMProvider.ANTHROPIC: ClaudeProvider,
    LLMProvider.OPENAI: OpenAIProvider,
    LLMProvider.LOCAL: LocalProvider,
}


@dataclass
class PoolConfigShim:
    """Quacks like :class:`LLMProviderConfig` but lives in env/settings.

    Used when a lawyer hasn't added their own key and we fall back to the
    platform-managed pool. Marked ``is_pool=True`` so callers can apply
    rate limits + token quotas.
    """

    provider: str
    api_key: str = ''
    base_url: str = ''
    default_model: str = ''
    label: str = 'Platform pool'
    is_pool: bool = True


def pool_config(provider: str) -> Optional['PoolConfigShim']:
    """Construct a pool config from Django settings, or ``None`` when the
    platform hasn't configured a pool key for this provider."""
    from django.conf import settings as dj_settings

    if provider == LLMProvider.ANTHROPIC:
        key = getattr(dj_settings, 'LLM_POOL_ANTHROPIC_API_KEY', '')
        if not key:
            return None
        return PoolConfigShim(
            provider=provider,
            api_key=key,
            default_model=getattr(dj_settings, 'LLM_POOL_ANTHROPIC_DEFAULT_MODEL', '') or ClaudeProvider.default_model,
        )
    if provider == LLMProvider.OPENAI:
        key = getattr(dj_settings, 'LLM_POOL_OPENAI_API_KEY', '')
        if not key:
            return None
        return PoolConfigShim(
            provider=provider,
            api_key=key,
            base_url=getattr(dj_settings, 'LLM_POOL_OPENAI_BASE_URL', '') or '',
            default_model=getattr(dj_settings, 'LLM_POOL_OPENAI_DEFAULT_MODEL', '') or OpenAIProvider.default_model,
        )
    if provider == LLMProvider.LOCAL:
        base = getattr(dj_settings, 'LLM_POOL_LOCAL_BASE_URL', '')
        if not base:
            return None
        return PoolConfigShim(
            provider=provider,
            base_url=base,
            default_model=getattr(dj_settings, 'LLM_POOL_LOCAL_DEFAULT_MODEL', '') or LocalProvider.default_model,
        )
    return None


def get_provider(config) -> BaseLLMProvider:
    """Return the concrete adapter for a saved configuration or pool shim."""
    cls = _REGISTRY.get(config.provider)
    if cls is None:
        raise ProviderError(f'Unknown provider: {config.provider}')
    return cls(config)


def list_supported() -> list[dict]:
    """Public description of every adapter — used by the settings UI."""
    return [
        {
            'value': LLMProvider.ANTHROPIC,
            'label': 'Anthropic (Claude)',
            'default_model': ClaudeProvider.default_model,
            'needs_api_key': True,
            'needs_base_url': False,
        },
        {
            'value': LLMProvider.OPENAI,
            'label': 'OpenAI (ChatGPT)',
            'default_model': OpenAIProvider.default_model,
            'needs_api_key': True,
            'needs_base_url': False,
        },
        {
            'value': LLMProvider.LOCAL,
            'label': 'Local / self-hosted',
            'default_model': LocalProvider.default_model,
            'needs_api_key': False,
            'needs_base_url': True,
        },
    ]
