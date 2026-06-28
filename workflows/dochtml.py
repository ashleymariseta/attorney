"""Shared normalisation for drafted-document bodies.

A ``WorkflowDocument.body`` can arrive as **HTML** (from the WYSIWYG editor) or
as **Markdown** (from an AI-Researcher answer saved as a document, or from a
precedent "convert to document"). The exporters and the matter-room fallback
all funnel through here so the detection lives in exactly one place.
"""
from __future__ import annotations

import html as _htmlmod
import re
from html.parser import HTMLParser

# Any of these block/inline tags means the body is already HTML.
_BLOCK_HTML = re.compile(
    r'<(p|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|div|br|img|strong|em|b|i|u|a|hr|pre)\b',
    re.I,
)

_BLOCK_TAGS = {
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
    'table', 'tr', 'thead', 'tbody', 'blockquote', 'hr', 'pre', 'section', 'article',
}


def looks_like_html(body: str) -> bool:
    return bool(body and _BLOCK_HTML.search(body))


def to_html(body: str) -> str:
    """Return an HTML string for ``body`` — passthrough if it's already HTML,
    otherwise convert the Markdown to HTML."""
    body = body or ''
    if looks_like_html(body):
        return body
    import markdown
    return markdown.markdown(body, extensions=['extra', 'sane_lists', 'nl2br'])


class _TextExtractor(HTMLParser):
    """Collapse HTML to readable plain text (block tags → blank line, <br> → newline)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == 'br':
            self.parts.append('\n')
        elif tag == 'li':
            self.parts.append('\n• ')

    def handle_endtag(self, tag):
        if tag in _BLOCK_TAGS:
            self.parts.append('\n\n')

    def handle_data(self, data):
        self.parts.append(data)

    def text(self) -> str:
        out = ''.join(self.parts)
        out = re.sub(r'[ \t]+\n', '\n', out)
        out = re.sub(r'\n{3,}', '\n\n', out)
        return out.strip()


def html_to_text(html: str) -> str:
    """Plain-text rendering of HTML, for the matter room (which shows
    ``Document.body`` as pre-wrapped plain text — raw tags would leak)."""
    if not html:
        return ''
    parser = _TextExtractor()
    try:
        parser.feed(html)
        parser.close()
        return parser.text()
    except Exception:  # noqa: BLE001 — never let a bad parse break a send
        return _htmlmod.unescape(re.sub(r'<[^>]+>', '', html)).strip()
