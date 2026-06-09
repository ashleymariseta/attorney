"""Two-factor auth (email + WhatsApp) — code generation, delivery and verify."""

import hashlib
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .models import OtpChallenge, OtpPurpose, TwoFactorMethod

log = logging.getLogger(__name__)

OTP_LENGTH = 6
OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5


def _hash(code: str) -> str:
    salt = getattr(settings, 'SECRET_KEY', '')
    return hashlib.sha256(f'{salt}:{code}'.encode()).hexdigest()


def issue_challenge(*, user, method: str, purpose: str = OtpPurpose.LOGIN) -> OtpChallenge:
    """Generate a code, store its hash + a public token, and dispatch it."""
    code = ''.join(secrets.choice('0123456789') for _ in range(OTP_LENGTH))
    challenge = OtpChallenge.objects.create(
        user=user,
        token=secrets.token_urlsafe(32),
        code_hash=_hash(code),
        method=method,
        purpose=purpose,
        expires_at=timezone.now() + timedelta(minutes=OTP_TTL_MINUTES),
    )
    _deliver(user=user, method=method, code=code, purpose=purpose)
    return challenge


def verify_challenge(*, token: str, code: str) -> OtpChallenge:
    """Returns the consumed challenge or raises ValueError with a public message."""
    challenge = OtpChallenge.objects.filter(token=token).first()
    if challenge is None:
        raise ValueError('Invalid or expired code.')
    if challenge.used_at is not None:
        raise ValueError('This code has already been used.')
    if challenge.expires_at < timezone.now():
        raise ValueError('Code expired — request a new one.')
    if challenge.attempts >= OTP_MAX_ATTEMPTS:
        raise ValueError('Too many attempts — request a new code.')
    challenge.attempts += 1
    if challenge.code_hash != _hash((code or '').strip()):
        challenge.save(update_fields=['attempts'])
        raise ValueError('That code didn\'t match. Try again.')
    challenge.used_at = timezone.now()
    challenge.save(update_fields=['attempts', 'used_at'])
    return challenge


def _deliver(*, user, method: str, code: str, purpose: str) -> None:
    subject = 'Your Attorney sign-in code' if purpose == OtpPurpose.LOGIN else 'Confirm your Attorney 2FA setup'
    body = (
        f'Your one-time code is: {code}\n\n'
        f'It expires in {OTP_TTL_MINUTES} minutes. If you did not request this, ignore this message.'
    )
    if method == TwoFactorMethod.EMAIL:
        try:
            send_mail(
                subject=subject,
                message=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )
        except Exception:  # pragma: no cover
            pass
    elif method == TwoFactorMethod.WHATSAPP:
        _whatsapp_send(user=user, body=body)
    # Always emit to the log so devs without a provider can still test.
    log.info('[OTP %s] sent %s code to %s: %s', purpose, method, user.email, code)


def _whatsapp_send(*, user, body: str) -> None:
    """Stub. Wire up a real provider (Twilio / Meta Cloud API) in production by
    setting WHATSAPP_API_URL + WHATSAPP_API_TOKEN. In dev we just log."""
    url = getattr(settings, 'WHATSAPP_API_URL', '') or ''
    if not url:
        log.info('[WHATSAPP stub] -> %s: %s', user.whatsapp_number or user.phone_number, body)
        return
    try:
        import requests  # type: ignore

        requests.post(
            url,
            json={'to': user.whatsapp_number or user.phone_number, 'body': body},
            headers={'Authorization': f"Bearer {getattr(settings, 'WHATSAPP_API_TOKEN', '')}"},
            timeout=8,
        )
    except Exception:  # pragma: no cover
        pass
