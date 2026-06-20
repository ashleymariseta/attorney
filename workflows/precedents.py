"""Precedent rendering — fill a Markdown precedent's ``{{placeholders}}`` from
collected field values."""
from __future__ import annotations

import re

_PLACEHOLDER = re.compile(r'\{\{\s*([a-zA-Z0-9_]+)\s*\}\}')


def render_precedent(body: str, values: dict) -> str:
    """Substitute ``{{key}}`` placeholders in ``body`` with ``values[key]``.

    Unfilled placeholders are replaced with a visible ``[KEY]`` marker so the
    drafter can see what still needs attention rather than leaving raw braces.
    """
    values = values or {}

    def repl(m: re.Match) -> str:
        key = m.group(1)
        val = values.get(key)
        if val is None or str(val).strip() == '':
            return f'[{key.upper()}]'
        return str(val)

    return _PLACEHOLDER.sub(repl, body or '')
