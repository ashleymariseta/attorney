from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from core.models import Matter, TrustTransaction, TrustTransactionType

from .models import Payment, PaymentStatus

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False)
class ProofOfPaymentFlowTests(APITestCase):
    def setUp(self):
        self.client_user = User.objects.create_user(
            email='client@example.com', password='passw0rd123', role='client_individual',
            first_name='Cli', last_name='Ent',
        )
        self.admin = User.objects.create_user(
            email='admin@example.com', password='passw0rd123', role='admin',
            first_name='Ad', last_name='Min', is_staff=True, is_superuser=True,
        )
        self.matter = Matter.objects.create(title='Contract review', client=self.client_user)

    def _pdf(self):
        return SimpleUploadedFile('pop.pdf', b'%PDF-1.4 fake', content_type='application/pdf')

    def test_create_payment_upload_pop_and_admin_verify_posts_to_trust_ledger(self):
        self.client.force_authenticate(self.client_user)

        # 1. Create the payment.
        resp = self.client.post(
            '/api/v1/payments/',
            {'matter': self.matter.id, 'amount': '250.00', 'currency': 'USD', 'provider': 'manual_pop'},
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        payment_id = resp.data['id']
        self.assertEqual(resp.data['status'], PaymentStatus.PENDING_REVIEW)

        # 2. Upload the proof of payment.
        resp = self.client.post(
            f'/api/v1/payments/{payment_id}/upload-proof/',
            {'proof_of_payment': self._pdf(), 'reference': 'BANK-REF-1'},
            format='multipart',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(Payment.objects.get(pk=payment_id).has_proof)

        # 3. A non-admin cannot review.
        resp = self.client.post(f'/api/v1/payments/{payment_id}/review/', {'status': 'verified'})
        self.assertEqual(resp.status_code, 403)

        # 4. Admin verifies -> trust deposit recorded.
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            f'/api/v1/payments/{payment_id}/review/',
            {'status': 'verified', 'review_note': 'Funds confirmed.'},
        )
        self.assertEqual(resp.status_code, 200, resp.content)

        payment = Payment.objects.get(pk=payment_id)
        self.assertEqual(payment.status, PaymentStatus.VERIFIED)
        self.assertIsNotNone(payment.trust_transaction)
        txn = payment.trust_transaction
        self.assertEqual(txn.transaction_type, TrustTransactionType.DEPOSIT)
        self.assertEqual(txn.amount, Decimal('250.00'))
        self.assertEqual(txn.matter_id, self.matter.id)

    def test_cannot_verify_without_proof(self):
        payment = Payment.objects.create(
            matter=self.matter, payer=self.client_user, amount=Decimal('10.00')
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f'/api/v1/payments/{payment.id}/review/', {'status': 'verified'})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(TrustTransaction.objects.count(), 0)

    def test_payer_cannot_attach_payment_to_foreign_matter(self):
        outsider = User.objects.create_user(
            email='outsider@example.com', password='passw0rd123', role='client_individual',
            first_name='Out', last_name='Sider',
        )
        self.client.force_authenticate(outsider)
        resp = self.client.post(
            '/api/v1/payments/', {'matter': self.matter.id, 'amount': '50.00'}
        )
        self.assertEqual(resp.status_code, 400)
