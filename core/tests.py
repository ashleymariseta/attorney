"""Smoke + permission tests for the most security-sensitive flows."""

from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    BillingModel,
    Channel,
    ClientProfile,
    Firm,
    LawyerProfile,
    Matter,
    MatterInvite,
    PaymentAccount,
    PaymentAccountType,
    Retainer,
    RetainerStatus,
)

User = get_user_model()


def _make_lawyer(email, firm=None, password='Lawyer1234!'):
    u = User.objects.create(email=email, first_name='L', last_name='Awyer', role='lawyer', is_verified=True)
    u.set_password(password)
    u.save()
    LawyerProfile.objects.create(user=u, firm=firm)
    return u


def _make_client(email, password='Client1234!'):
    u = User.objects.create(email=email, first_name='C', last_name='Lient', role='client_individual')
    u.set_password(password)
    u.save()
    ClientProfile.objects.create(user=u)
    return u


def _login(client, user, password):
    r = client.post('/api/v1/auth/token/', {'email': user.email, 'password': password}, format='json')
    assert r.status_code == 200, r.content
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {r.data["access"]}')


class LoginLockoutTests(TestCase):
    def setUp(self):
        self.user = _make_client('lockme@example.com')

    def test_lockout_after_five_failed_attempts(self):
        for _ in range(5):
            r = self.client.post('/api/v1/auth/token/', {'email': self.user.email, 'password': 'wrong'}, content_type='application/json')
            self.assertIn(r.status_code, (400, 401))
        r = self.client.post('/api/v1/auth/token/', {'email': self.user.email, 'password': 'Client1234!'}, content_type='application/json')
        self.assertEqual(r.status_code, 423)


class ReactionsAndThreadsTests(TestCase):
    def setUp(self):
        self.lawyer = _make_lawyer('counsel-2@example.com')
        self.client_user = _make_client('client-2@example.com')
        self.matter = Matter.objects.create(title='M', client=self.client_user, billing_model=BillingModel.CONSULTATION)
        self.matter.lawyers.add(self.lawyer)
        from .models import Channel
        self.channel = Channel.objects.create(channel_type='matter', matter=self.matter, name=self.matter.title)
        self.channel.members.add(self.lawyer, self.client_user)
        self.api = APIClient()
        _login(self.api, self.lawyer, 'Lawyer1234!')

    def test_react_toggles(self):
        r = self.api.post('/api/v1/messages/', {'channel': self.channel.id, 'content': 'hi'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        message_id = r.data['id']

        r = self.api.post(f'/api/v1/messages/{message_id}/react/', {'emoji': '👍'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data['reactions'][0]['count'], 1)

        r = self.api.post(f'/api/v1/messages/{message_id}/react/', {'emoji': '👍'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['reactions'], [])

    def test_thread_reply_and_reply_count(self):
        r = self.api.post('/api/v1/messages/', {'channel': self.channel.id, 'content': 'parent'}, format='json')
        parent_id = r.data['id']
        r = self.api.post('/api/v1/messages/', {'channel': self.channel.id, 'content': 'reply', 'parent': parent_id}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        r = self.api.get(f'/api/v1/messages/{parent_id}/replies/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 1)
        # The thread reply should not surface in the default channel listing.
        r = self.api.get(f'/api/v1/messages/?channel={self.channel.id}')
        contents = [m['content'] for m in r.data['results']]
        self.assertIn('parent', contents)
        self.assertNotIn('reply', contents)


class TwoFactorTests(TestCase):
    def setUp(self):
        self.user = _make_client('twofa@example.com')

    def test_setup_email_2fa_and_login_flow(self):
        from .models import OtpChallenge, TwoFactorMethod
        from .twofa import _hash

        api = APIClient()
        _login(api, self.user, 'Client1234!')

        # Begin setup.
        r = api.post('/api/v1/auth/2fa/setup/', {'method': 'email'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        setup_token = r.data['challenge_token']

        # Find the dispatched code (we hashed it; pull a fresh code via the
        # hash trick by trying the known-format code from logs is brittle —
        # instead, reach into the DB and bypass with our own hash check).
        challenge = OtpChallenge.objects.get(token=setup_token)
        # Brute the 6-digit code (test-only — production hash includes salt).
        # Easier path: directly overwrite the hash to a known code.
        challenge.code_hash = _hash('123456')
        challenge.save(update_fields=['code_hash'])

        r = api.post(
            '/api/v1/auth/2fa/setup/confirm/',
            {'challenge_token': setup_token, 'code': '123456'},
            format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.two_factor_method, TwoFactorMethod.EMAIL)

        # Now logging in should return requires_2fa instead of tokens.
        unauth = APIClient()
        r = unauth.post('/api/v1/auth/token/', {'email': self.user.email, 'password': 'Client1234!'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data.get('requires_2fa'))
        login_token = r.data['challenge_token']
        # Same trick — set a known code.
        login_challenge = OtpChallenge.objects.get(token=login_token)
        login_challenge.code_hash = _hash('654321')
        login_challenge.save(update_fields=['code_hash'])
        r = unauth.post(
            '/api/v1/auth/2fa/verify/',
            {'challenge_token': login_token, 'code': '654321'},
            format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn('access', r.data)

    def test_wrong_code_does_not_unlock(self):
        from .models import OtpChallenge, TwoFactorMethod, OtpPurpose
        from datetime import timedelta as _td

        # Pre-arrange: the user already has 2FA on with email.
        self.user.two_factor_method = TwoFactorMethod.EMAIL
        self.user.save(update_fields=['two_factor_method'])
        # Issue a challenge with a known hash.
        from .twofa import _hash

        challenge = OtpChallenge.objects.create(
            user=self.user,
            token='abc',
            code_hash=_hash('111111'),
            method=TwoFactorMethod.EMAIL,
            purpose=OtpPurpose.LOGIN,
            expires_at=timezone.now() + _td(minutes=10),
        )
        r = self.client.post(
            '/api/v1/auth/2fa/verify/',
            {'challenge_token': 'abc', 'code': '000000'},
            content_type='application/json',
        )
        self.assertEqual(r.status_code, 400)
        challenge.refresh_from_db()
        self.assertIsNone(challenge.used_at)


class WebSocketBroadcastTests(TransactionTestCase):
    """End-to-end: posting a message broadcasts a `message.created` over WS.

    Uses TransactionTestCase so the async consumer can see committed rows from
    setUp under SQLite (a regular TestCase wraps in an outer transaction the
    other thread can't read into)."""

    def setUp(self):
        from rest_framework_simplejwt.tokens import RefreshToken
        from .models import Channel

        self.lawyer = _make_lawyer('ws-lawyer@example.com')
        self.client_user = _make_client('ws-client@example.com')
        self.matter = Matter.objects.create(title='WS', client=self.client_user, billing_model=BillingModel.CONSULTATION)
        self.matter.lawyers.add(self.lawyer)
        self.channel = Channel.objects.create(channel_type='matter', matter=self.matter, name=self.matter.title)
        self.channel.members.add(self.lawyer, self.client_user)
        self.outsider = _make_lawyer('ws-out@example.com')
        # Issue tokens synchronously so async tests don't need to touch the ORM
        # from outside sync_to_async.
        self.lawyer_token = str(RefreshToken.for_user(self.lawyer).access_token)
        self.outsider_token = str(RefreshToken.for_user(self.outsider).access_token)

    def test_member_can_connect_outsider_cannot(self):
        import asyncio
        from channels.testing import WebsocketCommunicator
        from attorney.asgi import application

        channel_id = self.channel.id
        good_token = self.lawyer_token
        bad_token = self.outsider_token

        async def run():
            comm = WebsocketCommunicator(
                application,
                f'/ws/channel/{channel_id}/?token={good_token}',
                headers=[(b'origin', b'http://localhost')],
            )
            ok, _ = await comm.connect()
            self.assertTrue(ok, 'Member should connect')
            await comm.disconnect()

            comm = WebsocketCommunicator(
                application,
                f'/ws/channel/{channel_id}/?token={bad_token}',
                headers=[(b'origin', b'http://localhost')],
            )
            ok, _ = await comm.connect()
            self.assertFalse(ok, 'Outsider must be rejected')

        asyncio.run(run())

    def test_message_create_broadcasts_to_subscribers(self):
        import asyncio
        from channels.testing import WebsocketCommunicator
        from channels.db import database_sync_to_async
        from attorney.asgi import application
        from .views import _broadcast_channel
        from .serializers import MessageSerializer
        from .models import Message

        channel_id = self.channel.id
        token = self.lawyer_token
        sender_id = self.lawyer.id

        async def run():
            comm = WebsocketCommunicator(
                application,
                f'/ws/channel/{channel_id}/?token={token}',
                headers=[(b'origin', b'http://localhost')],
            )
            ok, _ = await comm.connect()
            self.assertTrue(ok)

            @database_sync_to_async
            def make_and_broadcast():
                from .models import User as UserModel, Channel as CH

                sender = UserModel.objects.get(pk=sender_id)
                channel = CH.objects.get(pk=channel_id)
                m = Message.objects.create(channel=channel, sender=sender, content='live!')
                payload = {'kind': 'message.created', 'message': MessageSerializer(m).data}
                _broadcast_channel(channel.id, payload)
                return m

            await make_and_broadcast()
            evt = await comm.receive_json_from(timeout=3)
            self.assertEqual(evt['kind'], 'message.created')
            self.assertEqual(evt['message']['content'], 'live!')
            await comm.disconnect()

        asyncio.run(run())


class HealthzTests(TestCase):
    def test_healthz_ok(self):
        r = self.client.get('/healthz')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['status'], 'ok')


class PasswordResetTests(TestCase):
    def setUp(self):
        self.user = _make_client('reset@example.com')

    def test_request_reset_is_silent_for_unknown_email(self):
        r = self.client.post('/api/v1/auth/password-reset/', {'email': 'nobody@example.com'}, content_type='application/json')
        self.assertEqual(r.status_code, 200)

    def test_full_reset_flow(self):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.http import urlsafe_base64_encode
        from django.utils.encoding import force_bytes

        token = default_token_generator.make_token(self.user)
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        r = self.client.post(
            '/api/v1/auth/password-reset/confirm/',
            {'uid': uid, 'token': token, 'password': 'NewSecret123!'},
            content_type='application/json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('NewSecret123!'))


class InviteAcceptTests(TestCase):
    def setUp(self):
        self.lawyer = _make_lawyer('counsel@example.com')
        self.client = APIClient()
        _login(self.client, self.lawyer, 'Lawyer1234!')

    def test_create_for_client_invites_new_user(self):
        r = self.client.post(
            '/api/v1/matters/create-for-client/',
            {
                'title': 'Lease review',
                'contact': {'first_name': 'New', 'last_name': 'Client', 'email': 'new@example.com', 'phone_number': '+263000'},
            },
            format='json',
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(MatterInvite.objects.filter(user__email='new@example.com').exists())

    def test_accept_invite_sets_password_and_issues_tokens(self):
        target = User.objects.create(email='invitee@example.com', first_name='I', last_name='V', role='client_individual')
        target.set_unusable_password()
        target.save()
        ClientProfile.objects.create(user=target)
        matter = Matter.objects.create(title='Test', client=target, billing_model=BillingModel.CONSULTATION)
        invite = MatterInvite.objects.create(user=target, matter=matter, invited_by=self.lawyer, token='abc123')
        r = self.client.post(
            '/api/v1/auth/accept-invite/',
            {'token': 'abc123', 'password': 'BrandNew123!'},
            format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn('access', r.data)
        invite.refresh_from_db()
        self.assertIsNotNone(invite.accepted_at)


class FirmVisibilityTests(TestCase):
    def setUp(self):
        self.firm = Firm.objects.create(name='Firm A', slug='firm-a')
        self.lawyer_a = _make_lawyer('a@example.com', firm=self.firm)
        self.lawyer_b = _make_lawyer('b@example.com', firm=self.firm)
        self.outsider = _make_lawyer('outsider@example.com')
        self.client_user = _make_client('client@example.com')
        self.matter = Matter.objects.create(title='M', client=self.client_user, billing_model=BillingModel.CONSULTATION)
        self.matter.lawyers.add(self.lawyer_a)

    def test_firm_member_sees_partner_matter(self):
        api = APIClient()
        _login(api, self.lawyer_b, 'Lawyer1234!')
        r = api.get('/api/v1/matters/')
        self.assertEqual(r.status_code, 200)
        ids = [m['id'] for m in r.data['results']]
        self.assertIn(self.matter.id, ids)

    def test_outsider_does_not_see_matter(self):
        api = APIClient()
        _login(api, self.outsider, 'Lawyer1234!')
        r = api.get('/api/v1/matters/')
        self.assertEqual(r.status_code, 200)
        ids = [m['id'] for m in r.data['results']]
        self.assertNotIn(self.matter.id, ids)


class PaymentAccountScopeTests(TestCase):
    def setUp(self):
        self.firm = Firm.objects.create(name='F', slug='f')
        self.admin = _make_lawyer('admin@example.com', firm=self.firm)
        self.firm.admin = self.admin
        self.firm.save(update_fields=['admin'])
        self.member = _make_lawyer('member@example.com', firm=self.firm)
        self.outsider = _make_lawyer('out@example.com')

    def test_only_admin_can_create_firm_account(self):
        api = APIClient()
        _login(api, self.member, 'Lawyer1234!')
        r = api.post(
            '/api/v1/payment-accounts/',
            {'account_type': PaymentAccountType.ECOCASH, 'identifier': '+263', 'owner_firm': self.firm.id},
            format='json',
        )
        self.assertEqual(r.status_code, 403)

        _login(api, self.admin, 'Lawyer1234!')
        r = api.post(
            '/api/v1/payment-accounts/',
            {'account_type': PaymentAccountType.ECOCASH, 'identifier': '+263', 'owner_firm': self.firm.id},
            format='json',
        )
        self.assertEqual(r.status_code, 201, r.content)

    def test_export_my_data_returns_dump(self):
        api = APIClient()
        _login(api, self.member, 'Lawyer1234!')
        r = api.get('/api/v1/me/export/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('user', r.data)
        self.assertIn('matters', r.data)
        self.assertIn('exported_at', r.data)

    def test_delete_account_requires_confirm_phrase(self):
        api = APIClient()
        _login(api, self.member, 'Lawyer1234!')
        r = api.post('/api/v1/me/delete/', {}, format='json')
        self.assertEqual(r.status_code, 400)
        r = api.post('/api/v1/me/delete/', {'confirm': 'DELETE'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.member.refresh_from_db()
        self.assertFalse(self.member.is_active)

    def test_user_cannot_mutate_other_users_account(self):
        target = PaymentAccount.objects.create(owner_user=self.admin, account_type=PaymentAccountType.ECOCASH, identifier='+1')
        api = APIClient()
        _login(api, self.outsider, 'Lawyer1234!')
        r = api.patch(f'/api/v1/payment-accounts/{target.id}/', {'identifier': '+9'}, format='json')
        # Either 404 (queryset excludes) or 403; both are acceptable defences.
        self.assertIn(r.status_code, (403, 404))
