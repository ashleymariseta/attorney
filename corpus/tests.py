"""Tests for the streaming Co-researcher endpoint (SSE), with retrieval and the
provider mocked so no network or vector index is needed."""
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from core.models import LawyerProfile
from corpus.services import Authority
from workflows import credits
from workflows.models import AIPlatformSettings, LLMProvider, LLMProviderConfig
from corpus.models import ResearchQuery

User = get_user_model()


def lawyer(email):
    u = User.objects.create_user(email=email, password='pw', role='lawyer')
    LawyerProfile.objects.create(user=u)
    return u


def fake_stream_adapter(_config):
    def stream(**_):
        yield {'type': 'delta', 'text': 'Section 5 '}
        yield {'type': 'delta', 'text': 'of the Act.'}
        yield {'type': 'done', 'text': 'Section 5 of the Act.', 'model': 'claude-haiku-4-5',
               'tokens_in': 30, 'tokens_out': 12}
    return SimpleNamespace(stream=stream)


AUTHORITIES = [Authority(title='HC 1/26', kind_display='Judgement', citation='', text='…s.5…', score=0.9)]


class StreamAskTests(APITestCase):
    def setUp(self):
        AIPlatformSettings.objects.update_or_create(pk=1, defaults={'free_tier_credits': 10_000})
        self.user = lawyer('stream@test.dev')
        LLMProviderConfig.objects.create(
            owner=self.user, provider=LLMProvider.ANTHROPIC, api_key='sk-x',
            default_model='claude-haiku-4-5', is_default=True,
        )

    @patch('corpus.views.vector_retrieve', lambda *a, **k: AUTHORITIES)
    @patch('corpus.views.get_provider', fake_stream_adapter)
    def test_stream_emits_deltas_done_and_settles_credits(self):
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/v1/co-researcher/ask/stream/',
                               {'question': 'grounds for divorce?'}, format='json')
        self.assertEqual(res.status_code, 200)
        body = b''.join(res.streaming_content).decode()
        self.assertIn('"type": "delta"', body)
        self.assertIn('Section 5 ', body)
        self.assertIn('"type": "done"', body)
        # Persisted answer + settled credits (10000 free - 42 actual).
        q = ResearchQuery.objects.get(owner=self.user)
        self.assertEqual(q.answer_text, 'Section 5 of the Act.')
        self.assertEqual(q.tokens_out, 12)
        self.assertEqual(credits.balance_for(self.user), 10_000 - 42)

    @patch('corpus.views.vector_retrieve', lambda *a, **k: AUTHORITIES)
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
