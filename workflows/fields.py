"""Transparent at-rest encryption for sensitive text columns (provider API
keys). Ciphertext is what's stored in the database; the Python attribute is
always plaintext, so callers (e.g. providers.py) need no changes.

The key is derived from ``settings.SECRET_KEY`` (no extra secret to manage).
Legacy plaintext values are returned as-is and re-encrypted on the next save,
so this is safe to roll out over existing data.
"""
import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models

# Marks a value as ciphertext so we can distinguish it from legacy plaintext.
_PREFIX = 'enc::'


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.SECRET_KEY.encode('utf-8')).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(text):
    if text in (None, ''):
        return text
    return _PREFIX + _fernet().encrypt(str(text).encode('utf-8')).decode('ascii')


def decrypt(value):
    if not isinstance(value, str) or not value.startswith(_PREFIX):
        return value  # None, '' or legacy plaintext
    try:
        return _fernet().decrypt(value[len(_PREFIX):].encode('ascii')).decode('utf-8')
    except InvalidToken:
        return value


class EncryptedTextField(models.TextField):
    """A TextField whose DB value is Fernet-encrypted at rest."""

    def from_db_value(self, value, expression, connection):
        return decrypt(value)

    def to_python(self, value):
        return decrypt(value)

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if value in (None, ''):
            return value
        # Avoid double-encrypting an already-ciphertext value.
        if isinstance(value, str) and value.startswith(_PREFIX):
            return value
        return encrypt(value)
