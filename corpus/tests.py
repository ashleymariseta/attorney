"""Tests for the Claude-only Co-researcher (streaming SSE chat). The provider
is mocked so no network calls are made."""
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from core.models import LawyerProfile
from corpus.models import ResearchQuery
from workflows import credits
from workflows.models import AIPlatformSettings, LLMProvider, LLMProviderConfig

User = get_user_model()


def lawyer(email):
    u = User.objects.create_user(email=email, password='pw', role='lawyer')
    LawyerProfile.objects.create(user=u)
    return u


def fake_stream_adapter(_config):
    def stream(**_):
        yield {'type': 'delta', 'text': 'The **Customary Marriages Act** '}
        yield {'type': 'delta', 'text': '[Chapter 5:07] applies.'}
        yield {'type': 'done', 'text': 'The **Customary Marriages Act** [Chapter 5:07] applies.',
               'model': 'claude-haiku-4-5', 'tokens_in': 30, 'tokens_out': 12}
    return SimpleNamespace(stream=stream)


class StreamAskTests(APITestCase):
    def setUp(self):
        AIPlatformSettings.objects.update_or_create(pk=1, defaults={'free_tier_credits': 10_000})
        self.user = lawyer('stream@test.dev')
        LLMProviderConfig.objects.create(
            owner=self.user, provider=LLMProvider.ANTHROPIC, api_key='sk-x',
            default_model='claude-haiku-4-5', is_default=True,
        )

    @patch('corpus.views.get_provider', fake_stream_adapter)
    def test_stream_emits_deltas_done_and_settles_credits(self):
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/v1/co-researcher/ask/stream/',
                               {'question': 'marriage law?', 'scope': ['statute']}, format='json')
        self.assertEqual(res.status_code, 200)
        body = b''.join(res.streaming_content).decode()
        self.assertIn('"type": "delta"', body)
        self.assertIn('Customary Marriages Act', body)
        self.assertIn('"type": "done"', body)
        q = ResearchQuery.objects.get(owner=self.user)
        self.assertIn('Chapter 5:07', q.answer_text)
        self.assertEqual(q.tokens_out, 12)
        self.assertEqual(credits.balance_for(self.user), 10_000 - 42)

    @patch('corpus.views.get_provider', fake_stream_adapter)
    def test_history_is_forwarded_for_multiturn(self):
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/v1/co-researcher/ask/stream/', {
            'question': 'and for civil marriages?',
            'history': [
                {'role': 'user', 'content': 'what governs customary marriages?'},
                {'role': 'assistant', 'content': 'The Customary Marriages Act.'},
            ],
        }, format='json')
        self.assertEqual(res.status_code, 200)
        b''.join(res.streaming_content)  # drain
        self.assertEqual(ResearchQuery.objects.filter(owner=self.user).count(), 1)

    @patch('corpus.views.get_provider', fake_stream_adapter)
    def test_stream_blocked_without_credits(self):
        AIPlatformSettings.objects.update_or_create(pk=1, defaults={'free_tier_credits': 0})
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/v1/co-researcher/ask/stream/',
                               {'question': 'what are the grounds for divorce?'}, format='json')
        body = b''.join(res.streaming_content).decode()
        self.assertIn('"type": "error"', body)
        self.assertIn('402', body)
        self.assertFalse(ResearchQuery.objects.filter(owner=self.user).exists())
