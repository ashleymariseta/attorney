"""HTML → formatted PDF for drafted legal documents.

Renders a drafted document to the firm's standard: **Book Antiqua 12pt, 1.5
line spacing, A4 with 1-inch margins, justified body, numbered paragraphs with
a hanging indent**, and a **9pt "Title — Page N" footer** on every page.

The body is HTML (from the WYSIWYG editor) — or Markdown from older documents,
normalised to HTML up-front via :func:`workflows.dochtml.to_html`. We walk the
HTML with lxml and emit reportlab flowables. reportlab Paragraphs understand a
small inline markup (``<b> <i> <u> <strike> <font> <a> <br/>``) which we build
from each element's inline children.
"""
from __future__ import annotations

import base64
import re
from io import BytesIO


def _resolve_fonts():
    """Register Book Antiqua for the PDF. Book Antiqua is a Palatino clone, so we
    use genuine Book Antiqua where present (Windows/Linux), else macOS Palatino
    (the same design), else fall back to the built-in Times serif — so the output
    works on any server without the font file."""
    import os

    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    REG, BOLD, ITAL, BI = 'BookAntiqua', 'BookAntiqua-Bold', 'BookAntiqua-Italic', 'BookAntiqua-BoldItalic'
    # Each face: list of (path, subfontIndex). First fully-resolvable set wins.
    candidate_sets = [
        {  # genuine Book Antiqua (Windows / msttcorefonts)
            REG: [('/usr/share/fonts/truetype/msttcorefonts/Book_Antiqua.ttf', 0), ('C:/Windows/Fonts/BKANT.TTF', 0)],
            BOLD: [('/usr/share/fonts/truetype/msttcorefonts/Book_Antiqua_Bold.ttf', 0), ('C:/Windows/Fonts/ANTQUAB.TTF', 0)],
            ITAL: [('/usr/share/fonts/truetype/msttcorefonts/Book_Antiqua_Italic.ttf', 0), ('C:/Windows/Fonts/ANTQUAI.TTF', 0)],
            BI: [('/usr/share/fonts/truetype/msttcorefonts/Book_Antiqua_Bold_Italic.ttf', 0), ('C:/Windows/Fonts/ANTQUABI.TTF', 0)],
        },
        {  # macOS Palatino collection (Book Antiqua's twin); .ttc subfont order: 0 Roman, 1 Italic, 2 Bold, 3 BoldItalic
            REG: [('/System/Library/Fonts/Palatino.ttc', 0)],
            BOLD: [('/System/Library/Fonts/Palatino.ttc', 2)],
            ITAL: [('/System/Library/Fonts/Palatino.ttc', 1)],
            BI: [('/System/Library/Fonts/Palatino.ttc', 3)],
        },
        {  # Linux TeX Gyre Pagella / URW Palladio (Palatino-compatible)
            REG: [('/usr/share/fonts/truetype/texgyre/texgyrepagella-regular.otf', 0)],
            BOLD: [('/usr/share/fonts/truetype/texgyre/texgyrepagella-bold.otf', 0)],
            ITAL: [('/usr/share/fonts/truetype/texgyre/texgyrepagella-italic.otf', 0)],
            BI: [('/usr/share/fonts/truetype/texgyre/texgyrepagella-bolditalic.otf', 0)],
        },
    ]
    for cset in candidate_sets:
        resolved = {}
        for name in (REG, BOLD, ITAL, BI):
            hit = next(((p, i) for (p, i) in cset[name] if os.path.exists(p)), None)
            if hit is None:
                break
            resolved[name] = hit
        if len(resolved) < 4:
            continue
        try:
            for name, (path, idx) in resolved.items():
                if name not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont(name, path, subfontIndex=idx))
            pdfmetrics.registerFontFamily(REG, normal=REG, bold=BOLD, italic=ITAL, boldItalic=BI)
            return REG, BOLD, ITAL
        except Exception:  # noqa: BLE001 — try the next candidate set
            continue
    # Built-in serif: closest to Book Antiqua without a font file.
    return 'Times-Roman', 'Times-Bold', 'Times-Italic'


FONT, FONT_BOLD, FONT_ITALIC = _resolve_fonts()

BODY_SIZE = 12
LEADING = 18          # 1.5 × 12pt
FOOTER_SIZE = 9
HANGING = 26          # left indent for list items (number sits in the gutter)


def _xml(s: str) -> str:
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _escattr(s: str) -> str:
    return _xml(s).replace('"', '&quot;')


# ---------------------------------------------------------------------------
# Inline markup: HTML element children → reportlab mini-markup
# ---------------------------------------------------------------------------

_INLINE_TAGS = {
    'strong': ('<b>', '</b>'), 'b': ('<b>', '</b>'),
    'em': ('<i>', '</i>'), 'i': ('<i>', '</i>'),
    'u': ('<u>', '</u>'),
    's': ('<strike>', '</strike>'), 'del': ('<strike>', '</strike>'), 'strike': ('<strike>', '</strike>'),
    'sup': ('<super>', '</super>'), 'sub': ('<sub>', '</sub>'),
    'mark': ('', ''),
}
_TRANSPARENT = {'p', 'div', 'span', 'label'}
# Block tags that are rendered as their own flowables, so inline conversion skips them.
_SKIP_INLINE = {'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'pre', 'blockquote',
                'figure', 'figcaption', 'img'}


def _tag(el) -> str:
    return (el.tag if isinstance(el.tag, str) else '').lower()


def _inline_html(node) -> str:
    """Balanced reportlab mini-markup from an element's inline content. Descends
    transparently through p/div/span; skips block children (handled separately)."""
    out: list[str] = []

    def render(el):
        if el.text:
            out.append(_xml(el.text))
        for child in el:
            t = _tag(child)
            if t == 'br':
                out.append('<br/>')
            elif t == 'code':
                out.append('<font face="Courier">'); render(child); out.append('</font>')
            elif t == 'a':
                href = child.get('href', '')
                out.append(f'<a href="{_escattr(href)}"><u>' if href else '<u>')
                render(child)
                out.append('</u></a>' if href else '</u>')
            elif t in _INLINE_TAGS:
                o, c = _INLINE_TAGS[t]
                out.append(o); render(child); out.append(c)
            elif t in _TRANSPARENT:
                render(child)
            elif t in _SKIP_INLINE:
                pass  # block child — emitted as its own flowable elsewhere
            else:
                render(child)
            if child.tail:
                out.append(_xml(child.tail))

    render(node)
    return ''.join(out).strip()


def _P(markup: str, style, **kw):
    """Build a Paragraph from inline markup, falling back to tag-stripped plain
    text if reportlab ever rejects the markup — so nothing breaks the whole PDF."""
    from reportlab.platypus import Paragraph
    try:
        return Paragraph(markup or ' ', style, **kw)
    except Exception:  # noqa: BLE001
        return Paragraph(_xml(re.sub(r'<[^>]+>', '', markup or ' ')), style, **kw)


def _styles():
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
    from reportlab.lib.styles import ParagraphStyle

    body = ParagraphStyle('body', fontName=FONT, fontSize=BODY_SIZE, leading=LEADING,
                          alignment=TA_JUSTIFY, spaceAfter=6)
    h1 = ParagraphStyle('h1', parent=body, fontName=FONT_BOLD, alignment=TA_CENTER,
                        spaceBefore=12, spaceAfter=6)
    h2 = ParagraphStyle('h2', parent=body, fontName=FONT_BOLD, alignment=TA_LEFT,
                        spaceBefore=12, spaceAfter=4)
    h3 = ParagraphStyle('h3', parent=body, fontName=FONT_BOLD, alignment=TA_LEFT,
                        spaceBefore=8, spaceAfter=2)
    h4 = ParagraphStyle('h4', parent=h3, spaceBefore=6)
    li = ParagraphStyle('li', parent=body, leftIndent=HANGING, spaceAfter=6)
    bullet = ParagraphStyle('bullet', parent=li, alignment=TA_LEFT)
    quote = ParagraphStyle('quote', parent=body, fontName=FONT_ITALIC, alignment=TA_LEFT,
                           leftIndent=HANGING, textColor=colors.HexColor('#444444'),
                           spaceBefore=4, spaceAfter=4)
    code = ParagraphStyle('code', parent=body, fontName='Courier', fontSize=9.5, leading=12,
                          alignment=TA_LEFT, backColor=colors.HexColor('#f4f4f4'),
                          borderPadding=6, spaceBefore=4, spaceAfter=4)
    cell = ParagraphStyle('cell', parent=body, fontSize=10.5, leading=14, alignment=TA_LEFT, spaceAfter=0)
    cell_h = ParagraphStyle('cell_h', parent=cell, fontName=FONT_BOLD)
    return {'body': body, 'h1': h1, 'h2': h2, 'h3': h3, 'h4': h4,
            'li': li, 'bullet': bullet, 'quote': quote, 'code': code,
            'cell': cell, 'cell_h': cell_h}


def _aligned(style, el):
    """Apply a CSS ``text-align`` (TipTap serialises it inline) to a paragraph style."""
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
    from reportlab.lib.styles import ParagraphStyle

    m = re.search(r'text-align\s*:\s*(left|right|center|justify)', el.get('style', ''), re.I)
    if not m:
        return style
    al = {'left': TA_LEFT, 'right': TA_RIGHT, 'center': TA_CENTER, 'justify': TA_JUSTIFY}[m.group(1).lower()]
    if al == style.alignment:
        return style
    return ParagraphStyle(style.name + '_al', parent=style, alignment=al)


def _image_flowable(url: str, avail_w: float):
    from reportlab.platypus import Image
    if not url or not url.startswith('data:'):
        return None  # only embed inlined images; don't fetch remote URLs server-side
    try:
        raw = base64.b64decode(url.split(',', 1)[1])
        img = Image(BytesIO(raw))
    except Exception:  # noqa: BLE001
        return None
    if img.drawWidth > avail_w:
        scale = avail_w / img.drawWidth
        img.drawWidth *= scale
        img.drawHeight *= scale
    img.hAlign = 'CENTER'
    return img


def _table_rows(table):
    """Return [(cells_markup, is_header), ...] for a <table>."""
    rows = []
    for tr in table.iter('tr'):
        cells, is_header = [], False
        for cell in tr:
            t = _tag(cell)
            if t not in ('td', 'th'):
                continue
            if t == 'th':
                is_header = True
            cells.append(_inline_html(cell))
        if cells:
            rows.append((cells, is_header))
    return rows


def _build_table(rows, S, avail_w):
    from reportlab.lib import colors
    from reportlab.platypus import Table, TableStyle

    ncol = max((len(c) for c, _ in rows), default=1) or 1
    pad = lambda r: (r + [''] * ncol)[:ncol]
    data, header_rows = [], []
    for ri, (cells, is_h) in enumerate(rows):
        if is_h:
            header_rows.append(ri)
        data.append([_P(c, S['cell_h'] if is_h else S['cell']) for c in pad(cells)])

    t = Table(data, colWidths=[avail_w / ncol] * ncol, hAlign='LEFT')
    cmds = [
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#999999')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    for ri in header_rows:
        cmds.append(('BACKGROUND', (0, ri), (-1, ri), colors.HexColor('#f0f0f0')))
    t.setStyle(TableStyle(cmds))
    return t


def _flowables_html(html: str, S, avail_w: float):
    import lxml.html as LH
    from reportlab.lib import colors
    from reportlab.platypus import HRFlowable, Paragraph, Preformatted

    flow = []

    def add_block(el):
        t = _tag(el)
        if t in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            style = S.get('h%d' % min(int(t[1]), 4), S['h4'])
            markup = _inline_html(el)
            if markup:
                flow.append(_P(markup, _aligned(style, el)))
        elif t in ('p', 'div'):
            markup = _inline_html(el)
            if markup:
                flow.append(_P(markup, _aligned(S['body'], el)))
            for child in el:  # block children that live inside a p/div (img, lists, …)
                if _tag(child) in ('img', 'ul', 'ol', 'table', 'blockquote', 'hr', 'pre', 'figure'):
                    add_block(child)
        elif t == 'ul':
            for li in el:
                if _tag(li) != 'li':
                    continue
                markup = _inline_html(li)
                if markup:
                    flow.append(_P(markup, S['bullet'], bulletText='•'))
                for sub in li:
                    if _tag(sub) in ('ul', 'ol'):
                        add_block(sub)
        elif t == 'ol':
            num = 1
            for li in el:
                if _tag(li) != 'li':
                    continue
                markup = _inline_html(li)
                if markup:
                    flow.append(_P(markup, S['li'], bulletText=f'{num}.'))
                    num += 1
                for sub in li:
                    if _tag(sub) in ('ul', 'ol'):
                        add_block(sub)
        elif t == 'blockquote':
            markup = _inline_html(el)
            if markup:
                flow.append(_P(markup, S['quote']))
        elif t == 'hr':
            flow.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#cccccc'),
                                   spaceBefore=8, spaceAfter=8))
        elif t == 'pre':
            flow.append(Preformatted(el.text_content() or ' ', S['code']))
        elif t == 'table':
            rows = _table_rows(el)
            if rows:
                flow.append(_build_table(rows, S, avail_w))
        elif t == 'img':
            img = _image_flowable(el.get('src', ''), avail_w)
            if img:
                flow.append(img)
        elif t in ('figure', 'section', 'article', 'header', 'footer', 'main'):
            for child in el:
                add_block(child)
        else:
            markup = _inline_html(el)
            if markup:
                flow.append(_P(markup, S['body']))

    try:
        root = LH.fragment_fromstring(html or '', create_parent='div')
    except Exception:  # noqa: BLE001
        root = LH.fromstring('<div>%s</div>' % (html or ''))

    if root.text and root.text.strip():
        flow.append(_P(_xml(root.text.strip()), S['body']))
    for el in root:
        add_block(el)

    if not flow:
        flow.append(Paragraph(' ', S['body']))
    return flow


def render_document_pdf(title: str, body: str) -> bytes:
    """Render a drafted document body (HTML or Markdown) to a formatted PDF."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate

    from .dochtml import to_html

    title = (title or 'Document').strip()
    page_w, _ = A4
    avail_w = page_w - 2 * inch
    S = _styles()
    story = _flowables_html(to_html(body), S, avail_w)

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont(FONT, FOOTER_SIZE)
        canvas.setFillColor(colors.HexColor('#333333'))
        label = f'{title} — Page {doc.page}'
        canvas.drawCentredString(page_w / 2, 0.6 * inch, label[:200])
        canvas.restoreState()

    buf = BytesIO()
    SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=inch, rightMargin=inch, topMargin=inch, bottomMargin=inch,
        title=title,
    ).build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
