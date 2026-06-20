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
    def test_conversation_saved_and_resumed(self):
        from corpus.models import ResearchConversation
        self.client.force_authenticate(self.user)
        # First turn creates a conversation.
        res = self.client.post('/api/v1/co-researcher/ask/stream/',
                               {'question': 'what governs customary marriages?'}, format='json')
        body = b''.join(res.streaming_content).decode()
        self.assertIn('"conversation"', body)
        conv = ResearchConversation.objects.get(owner=self.user)
        self.assertEqual(len(conv.messages), 2)  # user + assistant
        self.assertTrue(conv.title)
        # Second turn resumes the same conversation → appends, not a new one.
        res2 = self.client.post('/api/v1/co-researcher/ask/stream/',
                                {'question': 'and civil marriages?', 'conversation_id': conv.id}, format='json')
        b''.join(res2.streaming_content)
        self.assertEqual(ResearchConversation.objects.filter(owner=self.user).count(), 1)
        conv.refresh_from_db()
        self.assertEqual(len(conv.messages), 4)  # two turns

    def test_content_blocks_builds_for_each_type(self):
        import base64
        from corpus.views import _content_blocks, AttachmentError

        # No attachments → plain string.
        self.assertEqual(_content_blocks('hi', []), 'hi')

        text_b64 = base64.b64encode(b'clause 1: payment terms').decode()
        blocks = _content_blocks('summarise', [
            {'name': 'a.pdf', 'media_type': 'application/pdf', 'data': 'AAAA'},
            {'name': 'b.png', 'media_type': 'image/png', 'data': 'BBBB'},
            {'name': 'c.txt', 'media_type': 'text/plain', 'data': text_b64},
        ])
        kinds = [b['type'] for b in blocks]
        self.assertEqual(kinds, ['document', 'image', 'text', 'text'])  # +question text last
        self.assertIn('payment terms', blocks[2]['text'])
        self.assertEqual(blocks[-1]['text'], 'summarise')

        with self.assertRaises(AttachmentError):
            _content_blocks('q', [{'name': f'{i}', 'media_type': 'text/plain', 'data': 'AA'} for i in range(6)])
        with self.assertRaises(AttachmentError):
            _content_blocks('q', [{'name': 'x.exe', 'media_type': 'application/x-msdownload', 'data': 'AA'}])

    @patch('corpus.views.get_provider', fake_stream_adapter)
    def test_stream_with_attachment_records_name(self):
        import base64
        from corpus.models import ResearchConversation
        self.client.force_authenticate(self.user)
        res = self.client.post('/api/v1/co-researcher/ask/stream/', {
            'question': 'summarise this contract',
            'attachments': [{'name': 'contract.txt', 'media_type': 'text/plain',
                             'data': base64.b64encode(b'the parties agree...').decode()}],
        }, format='json')
        self.assertEqual(res.status_code, 200)
        b''.join(res.streaming_content)
        conv = ResearchConversation.objects.get(owner=self.user)
        self.assertIn('contract.txt', conv.messages[0]['content'])

    @patch('corpus.views.get_provider', fake_stream_adapter)
    def test_cannot_open_another_users_conversation(self):
        from corpus.models import ResearchConversation
        mine = ResearchConversation.objects.create(owner=self.user, title='x', messages=[])
        other = lawyer('other-conv@test.dev')
        self.client.force_authenticate(other)
        res = self.client.get(f'/api/v1/research-conversations/{mine.id}/')
        self.assertEqual(res.status_code, 404)

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
