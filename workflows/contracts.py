"""Contract review — prompt + structured-output parsing.

Claude analyses a contract into risk-rated sections (a "heat map") with
per-clause issues and recommendations. We ask for a strict JSON object and
parse it defensively.
"""
from __future__ import annotations

import json
import re

RISK_LEVELS = {'high', 'medium', 'low'}

CONTRACT_SYSTEM_PROMPT = (
    "You are a meticulous commercial contracts lawyer reviewing a contract for a "
    "Zimbabwean legal practitioner. Identify legal and commercial risk: one-sided "
    "or onerous terms, missing protections, ambiguities, unusual liabilities, "
    "termination/indemnity/IP/confidentiality/governing-law concerns, and anything "
    "a careful lawyer would flag.\n\n"
    "Return ONLY a single JSON object — no prose, no markdown, no code fences — "
    "matching exactly this shape:\n"
    "{\n"
    '  "title": string,                         // short contract name/type\n'
    '  "overall_risk": "high"|"medium"|"low",\n'
    '  "summary": string,                       // 2-4 sentence plain-English overview\n'
    '  "parties": [string],\n'
    '  "sections": [\n'
    "    {\n"
    '      "heading": string,                   // clause/section name\n'
    '      "risk": "high"|"medium"|"low",\n'
    '      "summary": string,                   // what this section does, briefly\n'
    '      "excerpt": string,                   // short quote from the contract (<=300 chars)\n'
    '      "issues": [\n'
    '        { "severity": "high"|"medium"|"low", "issue": string, "recommendation": string }\n'
    "      ]\n"
    "    }\n"
    "  ]\n"
    "}\n\n"
    "Cover every substantive section of the contract. If a section is fine, give it "
    'risk "low" and an empty issues array. Do not invent clauses that are not present."'
)

USER_INSTRUCTION = (
    "Review the attached contract and return the JSON analysis described in your "
    "instructions. Be thorough and specific to the actual text."
)


def _coerce_risk(value) -> str:
    v = str(value or '').strip().lower()
    return v if v in RISK_LEVELS else 'medium'


def _salvage_truncated(raw: str):
    """Recover a contract analysis whose JSON was cut off mid-output (the model
    hit its token limit). Keeps the head fields plus every fully-formed section
    object, then closes the structure."""
    idx = raw.find('"sections"')
    bracket = raw.find('[', idx) if idx != -1 else -1
    if bracket == -1:
        return None
    head = raw[:bracket + 1]  # everything up to and including the '['
    body = raw[bracket + 1:]

    objs, depth, start, in_str, esc = [], 0, None, False, False
    for i, ch in enumerate(body):
        if in_str:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start is not None:
                objs.append(body[start:i + 1])
                start = None
    if not objs:
        return None
    try:
        return json.loads(head + ','.join(objs) + ']}')
    except json.JSONDecodeError:
        return None


def parse_review(text: str) -> dict:
    """Parse Claude's JSON contract analysis defensively. Raises ValueError if
    no usable JSON object is found."""
    raw = (text or '').strip()
    # Strip code fences if present.
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
    # Fall back to the first {...} block, then to salvaging a truncated array.
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = None
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(0))
            except json.JSONDecodeError:
                data = None
        if data is None:
            data = _salvage_truncated(raw)
        if data is None:
            raise ValueError('Model did not return parseable JSON.')

    sections = []
    for s in (data.get('sections') or []):
        if not isinstance(s, dict):
            continue
        issues = []
        for it in (s.get('issues') or []):
            if not isinstance(it, dict):
                continue
            issues.append({
                'severity': _coerce_risk(it.get('severity')),
                'issue': str(it.get('issue') or '')[:1000],
                'recommendation': str(it.get('recommendation') or '')[:1000],
            })
        sections.append({
            'heading': str(s.get('heading') or 'Section')[:200],
            'risk': _coerce_risk(s.get('risk')),
            'summary': str(s.get('summary') or '')[:1000],
            'excerpt': str(s.get('excerpt') or '')[:400],
            'issues': issues,
        })

    return {
        'title': str(data.get('title') or '')[:300],
        'overall_risk': _coerce_risk(data.get('overall_risk')),
        'summary': str(data.get('summary') or '')[:2000],
        'parties': [str(p)[:200] for p in (data.get('parties') or []) if p][:12],
        'sections': sections,
    }
