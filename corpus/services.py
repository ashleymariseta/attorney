"""Retrieval + chunking utilities.

This module is the seam between the lawyer's question and the LLM prompt.
It exists in one file deliberately — when we move to pgvector/qdrant, swap
:func:`retrieve` only and the rest of the codebase is untouched.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable

from django.db.models import Q

from .models import CorpusChunk, CorpusKind


# Generic-English stop-words. Kept small on purpose; aggressive removal hurts
# legal queries (e.g. "the right to") more than it helps.
_STOP = {
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
    'have', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'so', 'that',
    'the', 'to', 'was', 'were', 'will', 'with', 'i', 'you', 'this', 'these',
    'those', 'what', 'when', 'where', 'who', 'why', 'how',
}

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z\-']{1,}")
_MIN_TOKEN_LEN = 3


def tokenize(text: str) -> list[str]:
    return [
        t.lower()
        for t in _TOKEN_RE.findall(text or '')
        if len(t) >= _MIN_TOKEN_LEN and t.lower() not in _STOP
    ]


@dataclass
class RetrievedChunk:
    chunk: CorpusChunk
    score: float


@dataclass
class Authority:
    """A single grounding source for the prompt — produced by either keyword
    retrieval (``chunk`` set) or semantic vector retrieval (``chunk`` None,
    snapshot fields carry the data)."""

    title: str
    kind_display: str
    citation: str
    text: str
    score: float = 0.0
    chunk: CorpusChunk | None = None


def keyword_authorities(retrieved: list['RetrievedChunk']) -> list['Authority']:
    """Adapt keyword :class:`RetrievedChunk` results to :class:`Authority`."""
    out: list[Authority] = []
    for r in retrieved:
        doc = r.chunk.document
        out.append(Authority(
            title=doc.title,
            kind_display=doc.collection.get_kind_display(),
            citation=doc.citation or '',
            text=r.chunk.text,
            score=r.score,
            chunk=r.chunk,
        ))
    return out


def chunk_text(body: str, target_size: int = 1200) -> list[str]:
    """Split ``body`` into ~``target_size``-char chunks at paragraph
    boundaries. Falls back to length-splitting for one giant paragraph."""

    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', body) if p.strip()]
    chunks: list[str] = []
    buffer: list[str] = []
    size = 0
    for para in paragraphs:
        if size + len(para) > target_size and buffer:
            chunks.append('\n\n'.join(buffer))
            buffer = []
            size = 0
        buffer.append(para)
        size += len(para) + 2
    if buffer:
        chunks.append('\n\n'.join(buffer))

    # Hard cap any single chunk that's still oversized.
    out: list[str] = []
    for c in chunks:
        if len(c) <= target_size * 1.5:
            out.append(c)
        else:
            for i in range(0, len(c), target_size):
                out.append(c[i:i + target_size])
    return out


def retrieve(
    question: str,
    scopes: Iterable[str] | None = None,
    k: int = 8,
) -> list[RetrievedChunk]:
    """Return the top-``k`` chunks for ``question``, optionally restricted
    to one or more :class:`CorpusKind` values.

    SQLite-friendly implementation: filter chunks by any keyword presence,
    score them in Python by token overlap, return top-k. Replace with a
    vector search when the deployment moves to Postgres + pgvector.
    """
    tokens = tokenize(question)
    if not tokens:
        return []

    # Narrow the candidate set with cheap OR ilike across keywords. This
    # avoids loading every chunk into Python.
    q = Q()
    for t in tokens[:8]:  # cap fanout
        q |= Q(text__icontains=t)
    qs = CorpusChunk.objects.filter(q).select_related('document', 'document__collection')

    valid_scopes = {s for s in (scopes or []) if s in {k for k, _ in CorpusKind.choices}}
    if valid_scopes:
        qs = qs.filter(document__collection__kind__in=valid_scopes)

    # Score by token frequency in chunk text. Cheap proxy for TF; good
    # enough at this corpus size.
    token_set = set(tokens)
    out: list[RetrievedChunk] = []
    for chunk in qs[:300]:  # safety bound for huge corpora
        text_tokens = tokenize(chunk.text)
        if not text_tokens:
            continue
        counts = Counter(text_tokens)
        overlap = sum(counts[t] for t in token_set if t in counts)
        if overlap == 0:
            continue
        # Normalise lightly by chunk length so long chunks don't dominate.
        score = overlap / (1.0 + len(text_tokens) ** 0.5)
        out.append(RetrievedChunk(chunk=chunk, score=score))

    out.sort(key=lambda r: r.score, reverse=True)
    return out[:k]


def build_research_prompt(
    question: str,
    authorities: list['Authority'],
    max_chars_per_authority: int = 900,
) -> tuple[str, str]:
    """Compose the system + user prompt for the Co-researcher LLM call.

    Returns ``(system, user)``. The system prompt locks the model into citing
    only the supplied authorities; the user prompt embeds them with stable
    ``[#n]`` markers the frontend renders as source pills. Each authority's
    text is truncated to keep token usage in check.
    """
    system = (
        "You are a legal research assistant for Zimbabwean practice. "
        "Answer ONLY from the supplied authorities. If the authorities do not "
        "address the question, say so. For every assertion of law, append "
        "the source marker like [#3] using the numbers given. Never invent "
        "citations, holdings, or section numbers."
    )

    parts = [f'QUESTION:\n{question}\n\nAUTHORITIES:']
    for i, a in enumerate(authorities, start=1):
        header = f'[#{i}] {a.kind_display} — {a.title}'
        if a.citation:
            header += f' ({a.citation})'
        text = (a.text or '').strip()
        if len(text) > max_chars_per_authority:
            text = text[:max_chars_per_authority].rstrip() + '…'
        parts.append(f'{header}\n{text}')
    parts.append(
        '\nAnswer in 2–6 short paragraphs. Cite every legal proposition with '
        'the [#n] markers above.'
    )
    return system, '\n\n'.join(parts)
