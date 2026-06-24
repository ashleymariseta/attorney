"""Precedent rendering — fill a Markdown precedent's ``{{placeholders}}`` from
collected field values; plus AI drafting of a brand-new precedent from a
plain-language description."""
from __future__ import annotations

import json
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


# ---------------------------------------------------------------------------
# AI drafting — turn a lawyer's plain-language brief into a reusable precedent.
# ---------------------------------------------------------------------------

TEMPLATE_SYSTEM_PROMPT = (
    "You are a senior legal drafter for Zimbabwean legal practice. The user "
    "describes a legal document template they need. Produce ONE reusable "
    "precedent in GitHub-flavoured Markdown, inserting {{placeholders}} "
    "(snake_case keys) everywhere a drafter must fill in case-specific detail "
    "— names, dates, case numbers, amounts, addresses, factual paragraphs, etc.\n\n"
    "Return ONLY a JSON object (no prose, no code fence) of this exact shape:\n"
    "{\n"
    '  "name": "short title",\n'
    '  "description": "one-line summary",\n'
    '  "category": "Affidavits | Pleadings | Agreements | Letters | Notices | Other",\n'
    '  "matter_type": "short practice area (optional)",\n'
    '  "body": "the full Markdown precedent containing {{placeholders}}",\n'
    '  "variables": [\n'
    '    {"key": "case_number", "label": "Case number", "type": "text", "required": true, "help": ""}\n'
    "  ]\n"
    "}\n\n"
    "Every {{placeholder}} used in the body MUST have a matching variable entry "
    'with an identical key. Use type "textarea" for multi-line/paragraph fields, '
    '"date" for dates, otherwise "text". Keep the document professional and '
    "complete; do not include commentary."
)


def parse_generated_template(text: str) -> dict:
    """Parse the model's JSON template draft defensively. The placeholders that
    actually appear in the body are the source of truth for ``variables`` — any
    model-supplied metadata is merged in by key. Raises ``ValueError`` when no
    usable body can be recovered."""
    raw = (text or '').strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        if not m:
            raise ValueError('Model did not return parseable JSON.')
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError as exc:
            raise ValueError('Model did not return parseable JSON.') from exc

    if not isinstance(data, dict) or not str(data.get('body') or '').strip():
        raise ValueError('Model did not return a template body.')

    body = str(data.get('body'))
    meta = {
        str(v['key']): v
        for v in (data.get('variables') or [])
        if isinstance(v, dict) and v.get('key')
    }

    variables = []
    seen = set()
    for match in _PLACEHOLDER.finditer(body):
        key = match.group(1)
        if key in seen:
            continue
        seen.add(key)
        v = meta.get(key, {})
        vtype = v.get('type') if v.get('type') in ('text', 'textarea', 'date') else 'text'
        variables.append({
            'key': key,
            'label': str(v.get('label') or key.replace('_', ' ').capitalize()),
            'type': vtype,
            'required': bool(v.get('required', True)),
            'help': str(v.get('help') or ''),
        })

    return {
        'name': str(data.get('name') or 'Untitled template')[:200],
        'description': str(data.get('description') or '')[:500],
        'category': str(data.get('category') or '')[:80],
        'matter_type': str(data.get('matter_type') or '')[:120],
        'body': body,
        'variables': variables,
    }
