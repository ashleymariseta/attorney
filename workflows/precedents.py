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
    "precedent in GitHub-flavoured Markdown.\n\n"
    "PLACEHOLDERS — be very sparing. Insert a {{placeholder}} (snake_case key) "
    "ONLY where a drafter must supply genuinely case-specific detail: the "
    "parties' names and addresses, the case number, key dates, the facts, the "
    "children, property descriptions, sums of money, and the relief sought. "
    "Prefer a FEW broad placeholders (e.g. one {{grounds}} or {{relief_sought}} "
    "textarea) over many tiny ones. Most templates need about 8–15 placeholders "
    "and rarely more than 20.\n"
    "NEVER create placeholders for the drafting firm's own details or for "
    "standard form wording. Write the following as ordinary fixed text — and for "
    "the firm block, a short editable note like '[Firm name, address, telephone, "
    "email, reference]' the lawyer fills in once — NOT as fill-in placeholders: "
    "the law firm / legal practitioners' name, address, telephone, fax and "
    "email; practitioner reference codes; practising-certificate or PC numbers; "
    "the Registrar / court-registry boilerplate; form numbers; rule citations; "
    "and the standard recitals and prayers. Do NOT emit keys like law_firm_name, "
    "law_firm_address, practitioner_ref, practising_certificate_number, "
    "pc_number or registrar — keep that text standing/verbatim.\n\n"
    "FORMATTING — separate every paragraph and block with a BLANK line so "
    "paragraphs render correctly (one blank line between paragraphs). Use a "
    "numbered list for numbered legal paragraphs. Keep the document professional "
    "and complete.\n\n"
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
    '"date" for dates, otherwise "text". Do not include commentary.'
)


_JSON_ESCAPES = {'n': '\n', 't': '\t', 'r': '\r', 'b': '\b', 'f': '\f', '"': '"', '\\': '\\', '/': '/'}


def _json_string_value(text: str, key: str) -> str | None:
    """Extract the string value of ``"key": "..."`` from (possibly truncated or
    malformed) JSON, decoding escapes. Stops at the closing quote, or at the end
    of the text if the response was cut off mid-string. Returns ``None`` if the
    key isn't present."""
    m = re.search(r'"' + re.escape(key) + r'"\s*:\s*"', text)
    if not m:
        return None
    i = m.end()
    out: list[str] = []
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == '\\':
            nxt = text[i + 1] if i + 1 < n else ''
            if nxt == 'u' and i + 6 <= n:
                try:
                    out.append(chr(int(text[i + 2:i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
            out.append(_JSON_ESCAPES.get(nxt, nxt))
            i += 2
            continue
        if ch == '"':
            break
        out.append(ch)
        i += 1
    return ''.join(out)


def parse_generated_template(text: str) -> dict:
    """Parse the model's JSON template draft defensively. The placeholders that
    actually appear in the body are the source of truth for ``variables`` — any
    model-supplied metadata is merged in by key. Raises ``ValueError`` when no
    usable body can be recovered."""
    raw = (text or '').strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)

    data = None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(0))
            except json.JSONDecodeError:
                data = None

    # Salvage a truncated/garbled response. The body is the only thing we truly
    # need — variables are re-derived from its {{placeholders}} below — so pull
    # out whatever string fields we can even from incomplete JSON.
    if not isinstance(data, dict) or not str(data.get('body') or '').strip():
        salvaged = {
            k: _json_string_value(raw, k)
            for k in ('name', 'description', 'category', 'matter_type', 'body')
        }
        if salvaged.get('body') and salvaged['body'].strip():
            data = {k: v for k, v in salvaged.items() if v is not None}
            data['variables'] = []

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
