"""Reusable upload validators."""

import os

from django.core.exceptions import ValidationError

MAX_IMAGE_MB = 5
MAX_DOC_MB = 15

IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
DOC_EXTS = IMAGE_EXTS | {'.pdf'}


def _ext(value):
    return os.path.splitext(getattr(value, 'name', ''))[1].lower()


def validate_avatar(value):
    if value.size > MAX_IMAGE_MB * 1024 * 1024:
        raise ValidationError(f'Image must be smaller than {MAX_IMAGE_MB} MB.')
    if _ext(value) not in IMAGE_EXTS:
        raise ValidationError('Avatar must be a PNG, JPG, WEBP or GIF.')


def validate_doc(value):
    if value.size > MAX_DOC_MB * 1024 * 1024:
        raise ValidationError(f'File must be smaller than {MAX_DOC_MB} MB.')
    if _ext(value) not in DOC_EXTS:
        raise ValidationError('File must be a PDF or image (PNG/JPG/WEBP/GIF).')
