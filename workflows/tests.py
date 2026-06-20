"""Tests for the AI module's money + auth paths.

Covers credit reservation/settlement (no overspend), the free tier, order
verification, usage throttles, stage-run authorization (IDOR), and the document
endpoints (precedent prepopulation, ownership, send-to-matter). The LLM provider
is mocked — no network calls.
"""
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from core.models import Firm, LawyerProfile, Matter
from workflows import credits
from workflows.credits import InsufficientCreditsError
from workflows.models import (
    AICreditAccount,
    AICreditOrder,
    AICreditPlan,
    AIPlatformSettings,
    CreditOrderStatus,
    LLMProvider,
    LLMProviderConfig,
    LLMUsageLog,
    LLMUserQuota,
    PrecedentTemplate,
    StageResult,
    Workflow,
    WorkflowStage,
)
from workflows.views import QuotaError, _enforce_pool_limits

User = get_user_model()


def make_lawyer(email, firm=None):
    u = User.objects.create_user(email=email, password='pw', role='lawyer')
    LawyerProfile.objects.create(user=u, firm=firm)
    return u


def fake_completion(tokens_in=100, tokens_out=50, text='Drafted answer.'):
    return SimpleNamespace(
        text=text, model='claude-haiku-4-5', tokens_in=tokens_in, tokens_out=tokens_out, raw={}
    )


def fake_adapter(**kw):
    return SimpleNamespace(complete=lambda **_: fake_completion(**kw))


class CreditReservationTests(APITestCase):
    def setUp(self):
        AIPlatformSettings.objects.update_or_create(pk=1, defaults={'free_tier_credits': 0})
        self.lawyer = make_lawyer('a@test.dev')

    def _grant(self, n):
        credits.grant_credits(credits.resolve_account(user=self.lawyer), n, note='test')

    def test_free_tier_granted_once(self):
        AIPlatformSettings.objects.update_or_create(pk=1, defaults={'free_tier_credits': 1000})
        acc = credits.resolve_account(user=self.lawyer)
        self.assertEqual(acc.balance, 1000)
        # Re-resolving must not grant again.
        acc2 = credits.resolve_account(user=self.lawyer)
        self.assertEqual(acc2.balance, 1000)

    def test_gate_blocks_at_zero(self):
        with self.assertRaises(InsufficientCreditsError):
            credits.begin_charge(self.lawyer)

    def test_reserve_then_settle_refunds_unused(self):
        self._grant(10_000)
        hold = credits.begin_charge(self.lawyer, estimate=6000)
        self.assertEqual(hold, 6000)
        self.assertEqual(credits.balance_for(self.lawyer), 4000)  # held
        credits.release_charge(self.lawyer, hold, 1500)  # actual << hold
        acc = credits.resolve_account(user=self.lawyer)
        self.assertEqual(acc.balance, 8500)        # 10000 - 1500 actual
        self.assertEqual(acc.lifetime_spent, 1500)

    def test_release_on_failure_refunds_full_hold(self):
        self._grant(5000)
        hold = credits.begin_charge(self.lawyer, estimate=6000)
        self.assertEqual(hold, 5000)               # capped at balance
        credits.release_charge(self.lawyer, hold, 0)  # call failed
        self.assertEqual(credits.balance_for(self.lawyer), 5000)
        self.assertEqual(credits.resolve_account(user=self.lawyer).lifetime_spent, 0)

    def test_concurrent_reservations_cannot_overspend(self):
        # Two holds taken before either settles must not exceed the balance.
        self._grant(8000)
        h1 = credits.begin_charge(self.lawyer, estimate=6000)
        h2 = credits.begin_charge(self.lawyer, estimate=6000)
        self.assertEqual(h1, 6000)
        self.assertEqual(h2, 2000)                 # only 2000 left to hold
        self.assertEqual(credits.balance_for(self.lawyer), 0)
        with self.assertRaises(InsufficientCreditsError):
            credits.begin_charge(self.lawyer)      # nothing left


class FirmAndOrderTests(APITestCase):
    def setUp(self):
        AIPlatformSettings.objects.update_or_create(pk=1, defaults={'free_tier_credits': 0})
        self.firm = Firm.objects.create(name='Dube & Co', slug='dube-co')
        self.l1 = make_lawyer('l1@test.dev', firm=self.firm)
        self.l2 = make_lawyer('l2@test.dev', firm=self.firm)
        self.admin = User.objects.create_user(email='admin@test.dev', password='pw', role='admin', is_staff=True)

    def test_firm_lawyers_share_one_account(self):
        a1 = credits.resolve_account(user=self.l1)
        a2 = credits.resolve_account(user=self.l2)
        self.assertEqual(a1.pk, a2.pk)
        self.assertTrue(a1.owner_firm_id)

    def test_verify_order_grants_credits_and_flips_to_paid(self):
        plan = AICreditPlan.objects.create(name='Silver', slug='silver', price='25', token_credits=150_000)
        order = AICreditOrder.objects.create(
            owner_firm=self.firm, created_by=self.l1, plan=plan,
            token_credits=plan.token_credits, amount=plan.price, status=CreditOrderStatus.PENDING,
        )
        acc = credits.resolve_account(user=self.l1)
        self.assertFalse(credits.is_on_paid_plan(acc))
        credits.verify_order(order, reviewer=self.admin)
        order.refresh_from_db()
        self.assertEqual(order.status, CreditOrderStatus.VERIFIED)
        self.assertEqual(credits.balance_for(self.l1), 150_000)   # shared by firm
        self.assertEqual(credits.balance_for(self.l2), 150_000)
        self.assertTrue(credits.is_on_paid_plan(credits.resolve_account(user=self.l2)))

    def test_cannot_double_verify(self):
        plan = AICreditPlan.objects.create(name='Bronze', slug='bronze', price='10', token_credits=50_000)
        order = AICreditOrder.objects.create(
            owner_firm=self.firm, plan=plan, token_credits=plan.token_credits, amount=plan.price,
            status=CreditOrderStatus.PENDING,
        )
        credits.verify_order(order, reviewer=self.admin)
        with self.assertRaises(ValueError):
            credits.verify_order(order, reviewer=self.admin)
        self.assertEqual(credits.balance_for(self.l1), 50_000)    # granted once


class QuotaTests(APITestCase):
    def setUp(self):
        AIPlatformSettings.objects.update_or_create(
            pk=1, defaults={'daily_token_quota': 20_000, 'rate_limit_per_minute': 20, 'free_tier_credits': 0}
        )
        self.lawyer = make_lawyer('q@test.dev')

    def test_daily_quota_blocks(self):
        LLMUserQuota.objects.create(owner=self.lawyer, daily_token_quota=100)
        LLMUsageLog.objects.create(owner=self.lawyer, provider='anthropic', tokens_in=60, tokens_out=60, pool=True)
        with self.assertRaises(QuotaError):
            _enforce_pool_limits(self.lawyer)

    def test_under_quota_passes(self):
        LLMUserQuota.objects.create(owner=self.lawyer, daily_token_quota=100_000)
        LLMUsageLog.objects.create(owner=self.lawyer, provider='anthropic', tokens_in=10, tokens_out=10, pool=True)
        _enforce_pool_limits(self.lawyer)  # should not raise

    def test_disabled_blocks(self):
        LLMUserQuota.objects.create(owner=self.lawyer, is_pool_disabled=True)
        with self.assertRaises(QuotaError):
            _enforce_pool_limits(self.lawyer)

    def test_zero_quota_means_unlimited(self):
        LLMUserQuota.objects.create(owner=self.lawyer, daily_token_quota=0, weekly_token_quota=0, monthly_token_quota=0)
        for _ in range(3):
            LLMUsageLog.objects.create(owner=self.lawyer, provider='anthropic', tokens_in=99999, tokens_out=0, pool=True)
        _enforce_pool_limits(self.lawyer)  # no token cap


@override_settings(CELERY_TASK_ALWAYS_EAGER=True, CELERY_TASK_EAGER_PROPAGATES=True)
class StageRunApiTests(APITestCase):
    def setUp(self):
        AIPlatformSettings.objects.update_or_create(pk=1, defaults={'free_tier_credits': 10_000})
        self.lawyer = make_lawyer('runner@test.dev')
        self.other = make_lawyer('other@test.dev')
        LLMProviderConfig.objects.create(
            owner=self.lawyer, provider=LLMProvider.ANTHROPIC, api_key='sk-test',
            default_model='claude-haiku-4-5', is_default=True,
        )
        self.wf = Workflow.objects.create(owner=self.lawyer, name='WF')
        self.stage = WorkflowStage.objects.create(
            workflow=self.wf, slug='draft', title='Draft', order=0, prompt_template='Write.',
        )

    def _run_url(self, stage):
        return f'/api/v1/workflow-stages/{stage.id}/run/'

    @patch('workflows.providers.get_provider', lambda config: fake_adapter())
    def test_run_succeeds_and_settles_actual_tokens(self):
        self.client.force_authenticate(self.lawyer)
        res = self.client.post(self._run_url(self.stage), {}, format='json')
        self.assertEqual(res.status_code, 202, res.content)  # async accepted
        # Eager task ran inline → result persisted + hold reconciled.
        self.assertEqual(StageResult.objects.filter(stage=self.stage).count(), 1)
        # 10000 free - 150 actual tokens = 9850 (hold fully reconciled).
        self.assertEqual(credits.balance_for(self.lawyer), 9850)

    @patch('workflows.providers.get_provider', lambda config: fake_adapter())
    def test_run_blocked_without_credits(self):
        # Drain the free tier.
        credits.begin_charge(self.lawyer, estimate=10_000)
        self.client.force_authenticate(self.lawyer)
        res = self.client.post(self._run_url(self.stage), {}, format='json')
        self.assertEqual(res.status_code, 402, res.content)
        self.assertEqual(StageResult.objects.filter(stage=self.stage).count(), 0)

    def test_cannot_run_another_lawyers_stage(self):
        self.client.force_authenticate(self.other)
        res = self.client.post(self._run_url(self.stage), {}, format='json')
        self.assertEqual(res.status_code, 404)  # filtered out by get_queryset


class DocumentApiTests(APITestCase):
    def setUp(self):
        AIPlatformSettings.objects.update_or_create(pk=1, defaults={'free_tier_credits': 0})
        self.lawyer = make_lawyer('doc@test.dev')
        self.other = make_lawyer('doc2@test.dev')
        self.precedent = PrecedentTemplate.objects.create(
            slug='aa', name='Answering Affidavit', body='IN THE {{court}} — {{deponent}}',
            variables=[{'key': 'court', 'label': 'Court', 'required': True}],
        )

    def test_create_from_precedent_prepopulates(self):
        self.client.force_authenticate(self.lawyer)
        res = self.client.post('/api/v1/workflow-documents/', {
            'precedent': self.precedent.id,
            'field_values': {'court': 'HIGH COURT', 'deponent': 'JANE'},
        }, format='json')
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data['body'], 'IN THE HIGH COURT — JANE')
        self.assertNotIn('{{', res.data['body'])

    def test_cannot_read_another_users_document(self):
        self.client.force_authenticate(self.lawyer)
        doc_id = self.client.post('/api/v1/workflow-documents/', {
            'title': 'Mine', 'body': 'secret',
        }, format='json').data['id']
        self.client.force_authenticate(self.other)
        res = self.client.get(f'/api/v1/workflow-documents/{doc_id}/')
        self.assertEqual(res.status_code, 404)

    def test_send_to_matter_requires_membership(self):
        # A matter the lawyer is NOT on.
        client_user = User.objects.create_user(email='client@test.dev', password='pw', role='client_individual')
        matter = Matter.objects.create(title='Not mine', client=client_user)
        self.client.force_authenticate(self.lawyer)
        doc_id = self.client.post('/api/v1/workflow-documents/', {'title': 'D', 'body': 'b'}, format='json').data['id']
        res = self.client.post(f'/api/v1/workflow-documents/{doc_id}/send-to-matter/', {'matter': matter.id}, format='json')
        self.assertEqual(res.status_code, 404)

        # Now add the lawyer to the matter → allowed, creates a draft.
        matter.lawyers.add(self.lawyer)
        res = self.client.post(f'/api/v1/workflow-documents/{doc_id}/send-to-matter/', {'matter': matter.id}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(matter.documents.filter(kind='draft').count(), 1)
