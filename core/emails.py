"""Branded transactional emails.

A single, email-client-safe HTML layout (tables + inline styles) shared by every
message we send — verification, password reset, 2FA codes, invites and general
notifications — plus a plain-text fallback. Everything degrades gracefully if
the SMTP backend is the console (dev) or delivery fails.
"""
from __future__ import annotations

import html as _html
import re

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

# Brand palette (mirrors the app's teal tokens).
_BRAND = '#0F766E'
_BRAND_DARK = '#115E59'
_INK = '#0F172A'
_MUTED = '#64748B'
_LINE = '#E5E7EB'
_CANVAS = '#F1F5F9'
_BRAND_NAME = 'Attorney'


def _esc(s) -> str:
    return _html.escape(str(s if s is not None else ''))


def _button(label: str, url: str) -> str:
    # Bulletproof-ish button (works across most clients).
    return f"""
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;">
      <tr><td align="center" bgcolor="{_BRAND_DARK}" style="border-radius:10px;">
        <a href="{_esc(url)}" target="_blank"
           style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;
                  font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;">
          {_esc(label)}
        </a>
      </td></tr>
    </table>"""


def _code_block(code: str) -> str:
    return f"""
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
      <tr><td align="center" bgcolor="{_CANVAS}"
              style="border:1px solid {_LINE};border-radius:12px;padding:16px 30px;
                     font-family:'Courier New',monospace;font-size:30px;font-weight:bold;
                     letter-spacing:10px;color:{_INK};">{_esc(code)}</td></tr>
    </table>"""


def render_email(
    *,
    heading: str,
    paragraphs: list[str],
    button: tuple[str, str] | None = None,
    code: str | None = None,
    preheader: str = '',
) -> tuple[str, str]:
    """Return (html, plain_text) for a branded email."""
    body_bits: list[str] = []
    for p in paragraphs:
        body_bits.append(
            f'<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:15px;line-height:1.6;color:{_INK};">{_esc(p)}</p>'
        )
    if code:
        body_bits.append(_code_block(code))
    if button:
        body_bits.append(_button(button[0], button[1]))
        body_bits.append(
            f'<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:12px;line-height:1.5;color:{_MUTED};">If the button doesn\'t work, '
            f'copy and paste this link into your browser:<br>'
            f'<a href="{_esc(button[1])}" style="color:{_BRAND};word-break:break-all;">{_esc(button[1])}</a></p>'
        )
    body_html = '\n'.join(body_bits)

    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:{_CANVAS};">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">{_esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_CANVAS};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <!-- header -->
        <tr><td style="background:{_BRAND};background:linear-gradient(135deg,{_BRAND},{_BRAND_DARK});
                       border-radius:16px 16px 0 0;padding:26px 32px;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:bold;
                       letter-spacing:2px;color:#ffffff;">{_BRAND_NAME.upper()}</span>
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;
                       color:rgba(255,255,255,0.8);"> &nbsp;LAW &amp; ADVISORY</span>
        </td></tr>
        <!-- card -->
        <tr><td style="background:#ffffff;padding:32px;border-left:1px solid {_LINE};border-right:1px solid {_LINE};">
          <h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:21px;
                     font-weight:bold;color:{_INK};">{_esc(heading)}</h1>
          {body_html}
        </td></tr>
        <!-- footer -->
        <tr><td style="background:#ffffff;border:1px solid {_LINE};border-top:0;
                       border-radius:0 0 16px 16px;padding:20px 32px 26px;">
          <hr style="border:0;border-top:1px solid {_LINE};margin:0 0 14px;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:{_MUTED};">
            {_BRAND_NAME} — verified legal counsel, on demand.<br>
            You received this email because an account or action used this address.
            If it wasn't you, you can safely ignore it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""

    # Plain-text alternative.
    text_lines = [heading, '']
    text_lines += paragraphs
    if code:
        text_lines += ['', f'Code: {code}']
    if button:
        text_lines += ['', f'{button[0]}: {button[1]}']
    text_lines += ['', '—', f'{_BRAND_NAME} — verified legal counsel, on demand.']
    text = '\n'.join(text_lines)
    return html, text


def send_branded(
    *,
    to: str,
    subject: str,
    heading: str,
    paragraphs: list[str],
    button: tuple[str, str] | None = None,
    code: str | None = None,
) -> bool:
    """Send a branded HTML email (with plain-text fallback). Returns True on
    success; never raises."""
    if not to or '@invite.attorney.local' in to:
        return False
    html, text = render_email(
        heading=heading, paragraphs=paragraphs, button=button, code=code,
        preheader=paragraphs[0] if paragraphs else subject,
    )
    try:
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[to],
        )
        msg.attach_alternative(html, 'text/html')
        msg.send(fail_silently=False)
        return True
    except Exception:  # noqa: BLE001 — email must never break the request
        return False


# ---- Higher-level helpers for the auth flows -------------------------------

def _verify_url_for(user) -> str:
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    token = default_token_generator.make_token(user)
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    return f'{settings.EMAIL_VERIFY_URL}?uid={uid}&token={token}'


def send_email_verification(user) -> bool:
    """Send the 'verify your email' message. Safe to call on registration."""
    if not user.email or getattr(user, 'email_verified', False):
        return False
    name = (user.first_name or '').strip()
    return send_branded(
        to=user.email,
        subject=f'Verify your {_BRAND_NAME} email',
        heading=f'Welcome{f", {name}" if name else ""} 👋',
        paragraphs=[
            f'Thanks for creating your {_BRAND_NAME} account. Please confirm that '
            f'{user.email} is your email address to activate everything.',
            'This link expires in 24 hours.',
        ],
        button=('Verify my email', _verify_url_for(user)),
    )


# Plain-text splitter for legacy notify() bodies → paragraphs.
def paragraphs_from_body(body: str) -> list[str]:
    if not body:
        return []
    parts = re.split(r'\n\s*\n', body.strip())
    return [re.sub(r'\s*\n\s*', ' ', p).strip() for p in parts if p.strip()]
