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


def render_report_markdown(title: str, result: dict) -> str:
    """Render a (possibly lawyer-edited) contract-review report as Markdown for
    a matter draft. Mirrors the on-screen report: overview, risk counts, parties,
    then each section with its issues and recommended fixes."""
    result = result or {}
    sections = result.get('sections') or []
    counts = {'high': 0, 'medium': 0, 'low': 0}
    for s in sections:
        r = (s.get('risk') or '').lower()
        if r in counts:
            counts[r] += 1

    out: list[str] = []
    out.append(f'# {title or result.get("title") or "Contract review"}')
    overall = (result.get('overall_risk') or '').upper()
    if overall:
        out.append(f'**Overall risk: {overall}**  ·  '
                   f'{counts["high"]} high · {counts["medium"]} medium · {counts["low"]} low')
    if result.get('parties'):
        out.append(f'**Parties:** {" · ".join(str(p) for p in result["parties"])}')
    if result.get('summary'):
        out.append('')
        out.append(str(result['summary']))

    for s in sections:
        risk = (s.get('risk') or '').upper()
        out.append('')
        out.append(f'## {s.get("heading") or "Section"} — {risk} risk')
        if s.get('summary'):
            out.append(str(s['summary']))
        if s.get('excerpt'):
            out.append('')
            out.append(f'> {s["excerpt"]}')
        issues = s.get('issues') or []
        if issues:
            out.append('')
            for it in issues:
                sev = (it.get('severity') or '').upper()
                out.append(f'- **[{sev}] {it.get("issue") or ""}**')
                if it.get('recommendation'):
                    out.append(f'  - _Fix:_ {it["recommendation"]}')

    out.append('')
    out.append('---')
    out.append('_AI-generated analysis, reviewed by counsel — not a substitute for full legal review._')
    return '\n'.join(out)


# ---------------------------------------------------------------------------
# PDF report — the same formatted document the lawyer downloads, generated
# server-side (reportlab) so it can be attached to a matter as a real file.
# ---------------------------------------------------------------------------

RISK_HEX = {'high': '#e11d48', 'medium': '#f59e0b', 'low': '#10b981'}


def _risk_color(risk):
    from reportlab.lib import colors
    return colors.HexColor(RISK_HEX.get((risk or '').lower(), '#999999'))


def _heatmap_flowable():
    from reportlab.lib.units import mm
    from reportlab.platypus import Flowable

    class HeatMap(Flowable):
        """A wrapping grid of risk-coloured rounded squares (the heat map)."""

        def __init__(self, risks, box=4.2 * mm, gap=1.4 * mm):
            super().__init__()
            self.risks = list(risks)
            self.box = box
            self.gap = gap
            self.per_row = 1
            self.width = 0
            self.height = 0

        def wrap(self, avail_w, avail_h):
            step = self.box + self.gap
            self.per_row = max(1, int((avail_w + self.gap) // step))
            rows = (len(self.risks) + self.per_row - 1) // self.per_row if self.risks else 0
            self.width = avail_w
            self.height = max(0, rows * step - self.gap)
            return (self.width, self.height)

        def draw(self):
            c = self.canv
            step = self.box + self.gap
            for i, rk in enumerate(self.risks):
                col, row = i % self.per_row, i // self.per_row
                x = col * step
                y = self.height - (row + 1) * step + self.gap
                c.setFillColor(_risk_color(rk))
                c.roundRect(x, y, self.box, self.box, 1.0, fill=1, stroke=0)

    return HeatMap


def render_report_pdf(title: str, result: dict) -> bytes:
    """Render the contract-review report as a formatted A4 PDF — title, overall
    risk, heat map, parties, summary, then each section (risk-accented) with its
    issues and recommended fixes. Mirrors the on-screen / downloadable report."""
    import html
    from io import BytesIO

    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
    )

    result = result or {}
    sections = result.get('sections') or []
    counts = {'high': 0, 'medium': 0, 'low': 0}
    for s in sections:
        r = (s.get('risk') or '').lower()
        if r in counts:
            counts[r] += 1

    def esc(v):
        return html.escape(str(v if v is not None else ''))

    from .docpdf import FONT, FONT_BOLD, FONT_ITALIC

    base = getSampleStyleSheet()['Normal']
    body = ParagraphStyle('body', parent=base, fontName=FONT, fontSize=10.5, leading=15)
    h1 = ParagraphStyle('h1', parent=body, fontName=FONT_BOLD, fontSize=18, leading=22,
                        alignment=TA_LEFT, spaceAfter=4)
    meta = ParagraphStyle('meta', parent=body, fontSize=9, textColor=colors.HexColor('#444444'))
    label = ParagraphStyle('label', parent=meta, fontSize=8, textColor=colors.HexColor('#666666'))
    h2 = ParagraphStyle('h2', parent=body, fontName=FONT_BOLD, fontSize=12.5, leading=16,
                        spaceBefore=12, spaceAfter=2)
    quote = ParagraphStyle('quote', parent=body, fontName=FONT_ITALIC, fontSize=9.5, leading=13,
                           leftIndent=10, textColor=colors.HexColor('#555555'), spaceBefore=3, spaceAfter=3)
    issue = ParagraphStyle('issue', parent=body, fontSize=10, leading=14, spaceBefore=4, leftIndent=2)
    fix = ParagraphStyle('fix', parent=body, fontSize=9.5, leading=13, leftIndent=14,
                         textColor=colors.HexColor('#444444'))
    foot = ParagraphStyle('foot', parent=meta, fontSize=8, textColor=colors.HexColor('#777777'))

    story = []
    doc_title = title or result.get('title') or 'Contract review'
    story.append(Paragraph(esc(doc_title), h1))

    overall = (result.get('overall_risk') or '').lower()
    story.append(Paragraph(
        f'<b><font color="{RISK_HEX.get(overall, "#999999")}">{esc(overall).upper() or "—"} RISK</font></b>'
        f'  &nbsp;·&nbsp;  {counts["high"]} high &nbsp; {counts["medium"]} medium &nbsp; {counts["low"]} low',
        meta,
    ))
    if result.get('parties'):
        story.append(Paragraph(f'<b>Parties:</b> {esc(" · ".join(str(p) for p in result["parties"]))}', meta))

    if sections:
        story.append(Spacer(1, 7))
        story.append(Paragraph('HEAT MAP', label))
        story.append(Spacer(1, 3))
        story.append(_heatmap_flowable()([s.get('risk') for s in sections]))

    if result.get('summary'):
        story.append(Spacer(1, 9))
        story.append(Paragraph(esc(result['summary']), body))

    for s in sections:
        risk = (s.get('risk') or '').lower()
        head = Paragraph(
            f'{esc(s.get("heading") or "Section")}'
            f'  <font size="8" color="{RISK_HEX.get(risk, "#999999")}"><b>· {esc(risk).upper()} RISK</b></font>',
            h2,
        )
        # A thin coloured left bar beside the heading, like the on-screen accent.
        bar = Table([['', head]], colWidths=[2.4, None])
        bar.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, 0), _risk_color(risk)),
            ('LEFTPADDING', (0, 0), (0, 0), 0), ('RIGHTPADDING', (0, 0), (0, 0), 0),
            ('LEFTPADDING', (1, 0), (1, 0), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(bar)

        if s.get('summary'):
            story.append(Paragraph(esc(s['summary']), body))
        if s.get('excerpt'):
            story.append(Paragraph(f'“{esc(s["excerpt"])}”', quote))
        for it in (s.get('issues') or []):
            sev = (it.get('severity') or '').lower()
            story.append(Paragraph(
                f'<b><font color="{RISK_HEX.get(sev, "#999999")}">[{esc(sev).upper()}]</font></b> '
                f'{esc(it.get("issue"))}',
                issue,
            ))
            if it.get('recommendation'):
                story.append(Paragraph(f'<i>Fix:</i> {esc(it["recommendation"])}', fix))

    story.append(Spacer(1, 14))
    story.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#cccccc')))
    story.append(Spacer(1, 4))
    story.append(Paragraph('AI-generated analysis, reviewed by counsel — not a substitute for full legal review.', foot))

    buf = BytesIO()
    SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=16 * mm, rightMargin=16 * mm,
        title=doc_title,
    ).build(story)
    return buf.getvalue()
